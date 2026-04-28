# Codec Model Unification — Execution Plan

## Summary

Promote codec parameterization into a first-class `ParameterizedCodec` interface with a co-located type-level brand, a single `columnFor` authoring helper, and standard-schema-driven JSON inference. Rewrite the no-emit `FieldOutputType` once against the brand so parameterized columns (`vector(1536)`, `char(36)`, JSON-shaped scalars) resolve to their precise branded TS types in both the emit and no-emit paths. Resolves [TML-2229](https://linear.app/prisma-company/issue/TML-2229) by addressing its root cause rather than the surface symptom.

**Spec:** [projects/codec-model-unification/spec.md](spec.md)

**Linear:** [TML-2229](https://linear.app/prisma-company/issue/TML-2229) — to be re-scoped after spec/plan iteration

**Base branch:** `origin/worktree/op-registry-ts` ([PR #374](https://github.com/prisma/prisma-next/pull/374))

## Collaborators

| Role | Person | Context |
|---|---|---|
| Maker | Will | Drives execution |
| Reviewer | _TBD_ | Architectural review of brand mechanism + base `Codec` cleanup |
| Collaborator | Pack authors | Affected by `columnFor` API and removal of optional fields from `Codec` |

## Sequencing notes

- **Depends on PR #374**: this branch is based on `origin/worktree/op-registry-ts`. Once #374 merges to `main`, rebase to `origin/main`. The plan assumes #374 is the implementation surface for `Expression<T>` and `CodecExpression<…>`; M5 verifies brand-resolved types flow through them.
- **Hard cut on the base `Codec` cleanup** (M5): no deprecation window. All migrations land first (M3, M4), then the optional fields disappear from base `Codec` in one commit.
- **JSON-codec helper** (M2 step 2.4) intentionally lands before the brand is wired into pgvector so that the JSON path drives the `Brand['Input']` ergonomics.

## Milestones

### Milestone 0: Baseline & scaffolding

Capture before-state metrics so the M5/M6 budgets in [spec §A8](spec.md#a8-build-performance-budget) are measurable, and lock the project to PR #374's branch tip.

**Tasks:**

- [ ] 0.1 — Record a typecheck baseline for `@prisma-next/sql-relational-core` and `@prisma-next/contract-ts` (3 runs each, median wall time) into `projects/codec-model-unification/assets/typecheck-baseline.md`. Used as the ±20% gate for A8.
- [ ] 0.2 — Confirm the base branch matches `origin/worktree/op-registry-ts`. Document the rebase contract in `assets/base-branch-notes.md`: when #374 merges to main, this branch rebases to `origin/main` (not to a renamed branch).

### Milestone 1: `ParameterizedCodec` interface, brand mechanism, factory

The minimal vertical: define the new shape, add a factory, prove the brand mechanism with a synthetic codec. No production codecs migrate yet.

**Validation:** type-level tests for `Apply<Brand, Params>` with a fixture `Brand`, factory typecheck failures when required fields are omitted.

**Tasks:**

- [ ] 1.1 — In `@prisma-next/framework-components`, add `CodecBrand` and `Apply<B, P>` (5 LOC). Type-level test fixtures: a `VectorBrand` extending `CodecBrand` with `Output: this['Input'] extends { length: infer N extends number } ? Vector<N> : never`. Test: `Apply<VectorBrand, { length: 1536 }>` ≡ `Vector<1536>`.
- [ ] 1.2 — In `@prisma-next/framework-components`, add `ParameterizedCodec<Id, Traits, Wire, Js, Params, Helper, Brand>` extending `Codec` with required `paramsSchema`, `renderOutputType`, `Brand`. Optional `init`. Type-level test: `ParameterizedCodec` is assignable to `Codec`.
- [ ] 1.3 — In `@prisma-next/sql-relational-core/ast`, add `parameterizedCodec({ … })` factory wrapping `codec()`. Validates at the type level that `Brand['Input']` is assignable from `Params`. Negative type tests (`.test-d.ts`) for: missing `Brand`, missing `paramsSchema`, missing `renderOutputType`, brand whose `Input` doesn't match `Params`.
- [ ] 1.4 — Update `@prisma-next/sql-relational-core/ast`'s `paramsSchema` from `Type<TParams>` (arktype-only) to `StandardSchemaV1<TParams>`. Verify existing arktype callers still typecheck (Arktype implements StandardSchema).
- [ ] 1.5 — Type-level test: a synthetic `Length3StringBrand` brand applied to `{ n: 3 }` resolves to a length-3 phantom-typed string. Confirms the HKT idiom works for non-vector shapes.

### Milestone 2: `columnFor` helper + JSON-codec helper

Author-facing surface lands. Pack authors gain a single helper and a Standard-Schema JSON path. Still no migration of production codecs.

**Validation:** runtime tests for `columnFor` validation; type-level tests for `columnFor(parameterizedCodec)(params)` literal preservation; type-level test for a JSON column with an Arktype schema resolving to the schema's type.

**Tasks:**

- [ ] 2.1 — In `@prisma-next/contract-authoring` (or wherever `ColumnTypeDescriptor` exports live), add `columnFor<C extends Codec | ParameterizedCodec>(codec)`. Discriminate via conditional return type: parameterized → `(params) => ColumnTypeDescriptor & { typeParams: Params }`; non-parameterized → `ColumnTypeDescriptor`.
- [ ] 2.2 — Runtime test: `columnFor(paramCodec)(validParams)` returns the descriptor with literal `typeParams`. `columnFor(paramCodec)(invalidParams)` throws via `paramsSchema.~standard.validate`.
- [ ] 2.3 — Type-level test: `columnFor(pgVectorCodec)(...)` constrains `params` to `Brand['Input']`-compatible objects; passing `{ length: 'oops' }` fails to typecheck.
- [ ] 2.4 — Add `jsonCodec(schema)` helper in framework-components (or sql-relational-core, depending on where the existing `pgJsonCodec` lives). Wraps a `StandardSchemaV1` schema. Brand: `SchemaBrand<S>` with `Output: StandardSchemaV1.InferOutput<S>`. `paramsSchema` accepts `{ schema: <any standard schema> }`.
- [ ] 2.5 — Type-level test: `columnFor(jsonCodec)({ schema: arktypeSchema })` resolves to `arktypeSchema`'s inferred TS type when consumed by `FieldOutputTypes` (uses a fresh fixture contract).

### Milestone 3: No-emit `FieldOutputType` rewrite

The headline fix. Rewrites the no-emit path against the brand. Migrates pgvector to drive the test scenarios end-to-end.

**Validation:** comprehensive type-level tests in `contract-types.test-d.ts` covering inline `typeParams`, `typeRef`, JSON schemas, non-parameterized fallback, nullability.

**Tasks:**

- [ ] 3.1 — Migrate `pgVectorCodec` to `parameterizedCodec({ … })` with co-located `VectorBrand`. Replace `vector(N)` factory in `packages/3-extensions/pgvector/src/exports/column-types.ts` with `columnFor(pgVectorCodec)`. Existing pgvector tests must still pass.
- [ ] 3.2 — Rewrite `FieldOutputType` in `packages/2-sql/2-authoring/contract-ts/src/contract-types.ts` per [spec FR5](spec.md#fr5-no-emit-fieldoutputtype-rewrite). Add `CodecsForDefinition<Definition>` lookup that pulls codec instances (not just `CodecTypes`) from the contract's target + extension packs.
- [ ] 3.3 — Type-level test in `contract-ts/test`: a fixture contract with a `vector(1536)` column resolves the field type to `Vector<1536>` (was `number[]`).
- [ ] 3.4 — Type-level test: a fixture contract with `storage.types: { Embedding1536: vector(1536) }` and a column with `typeRef: 'Embedding1536'` also resolves to `Vector<1536>`.
- [ ] 3.5 — Type-level test: a JSON column declared via `columnFor(jsonCodec)({ schema: arktypeSchema })` resolves to the schema's inferred type.
- [ ] 3.6 — Type-level test: nullability — `vector(1536)` nullable column resolves to `Vector<1536> | null`.
- [ ] 3.7 — Type-level test: a non-parameterized column (`text`, `int4`) still resolves to the base codec output type (regression guard).
- [ ] 3.8 — Type-level test in `@prisma-next/sql-relational-core/test`: `ComputeColumnJsType` returns the brand-resolved type for the same fixture columns (delegates to `ExtractFieldOutputTypes` so the fix flows transparently).

### Milestone 4: Migrate remaining parameterized codecs

Convert the rest. Largest scope by file count, but mechanical once M3 lands.

**Validation:** every migrated codec has a co-located `Brand`, an updated `columnFor` export, and existing tests pass.

**Tasks:**

- [ ] 4.1 — Migrate postgres core codecs (per `rg -l "renderOutputType" packages/3-targets/`): `pgNumericCodec`, `pgTimestampCodec`, `pgJsonCodec`, `pgJsonbCodec`, and any `pgCharCodec`. One brand per codec. One `columnFor(...)` export per codec.
- [ ] 4.2 — Migrate mongo codecs (per `rg -l "renderOutputType" packages/2-mongo-family/ packages/3-mongo-target/`): convert to `parameterizedCodec({ … })` with co-located brands. Update mongo column factories analogously.
- [ ] 4.3 — Migrate sqlite/paradedb codecs if they declare `renderOutputType?` (check via `rg -l "renderOutputType" packages/3-targets/ packages/3-extensions/`).
- [ ] 4.4 — Update `packages/3-extensions/pgvector/test/codec-render-output-type.test.ts` and `packages/3-targets/6-adapters/postgres/test/codec-render-output-type.test.ts` to call `renderOutputType` through the parameterized type (no behavioural change expected; assertion shapes may tighten).
- [ ] 4.5 — `pnpm test:packages` passes across the workspace.
- [ ] 4.6 — `pnpm lint:deps` passes.

### Milestone 5: Base `Codec` cleanup + Expression integration

Hard cut: remove the optional parameterization fields from base `Codec`. Verify PR #374's `Expression<T>` / `CodecExpression<…>` consume brand-resolved types.

**Validation:** workspace-wide typecheck, no `@ts-expect-error` regressions, expression-level type tests show brand-resolved types.

**Tasks:**

- [ ] 5.1 — Remove `paramsSchema?`, `init?`, `renderOutputType?` from `packages/1-framework/1-core/framework-components/src/codec-types.ts`'s base `Codec` interface. Remove the same fields from `@prisma-next/sql-relational-core/ast`'s `Codec` extension where they were only for parameterized codecs.
- [ ] 5.2 — Update the SQL `codec()` factory: drop `paramsSchema`, `init`, `renderOutputType` from its config type. Pack authors using `codec()` for parameterized codecs get a clear compile error pointing at `parameterizedCodec()`.
- [ ] 5.3 — Verify `pnpm typecheck` passes across the workspace. Fix any callers that still consult `codec.renderOutputType` without narrowing to `ParameterizedCodec` (registry consumers — emitters and the runtime context builder).
- [ ] 5.4 — Type-level test: a `CodecExpression<'pg/vector@1', false, CT>` over a `vector(1536)` column carries `Vector<1536>` as its `returnType`'s inferred output (consumes [PR #374](https://github.com/prisma/prisma-next/pull/374)'s plumbing).
- [ ] 5.5 — Re-record typecheck timings for `@prisma-next/sql-relational-core` and `@prisma-next/contract-ts`. Compare against M0's baseline; confirm within ±20%.

### Milestone 6: Documentation, ADR, close-out

Pack-author-visible docs land, ADR finalizes the architectural decision, project artifacts migrate to `docs/`.

**Validation:** ADR exists at `docs/architecture docs/adrs/`, codecs subsystem doc updated, project folder deletable.

**Tasks:**

- [ ] 6.1 — Add a "Authoring a parameterized codec" section to the README of the package hosting `parameterizedCodec` and `columnFor` (likely `@prisma-next/sql-relational-core` or `@prisma-next/contract-authoring`). Worked example: pgvector. Per `.cursor/rules/doc-maintenance.mdc`, link contributor details from the package README.
- [ ] 6.2 — Update `docs/architecture docs/subsystems/` codec-related doc(s) to describe `ParameterizedCodec`, `CodecBrand`, `columnFor`, and the storage.types/typeRef relationship per [spec OQ6](spec.md#open-questions).
- [ ] 6.3 — Draft ADR `docs/architecture docs/adrs/ADR XXX - Codec model unification.md` extending ADR 186. Records: parameterization promoted to first-class interface; brand co-located; `columnFor` unified helper; Standard Schema for JSON inference; no-emit `FieldOutputType` rewritten against the brand; base `Codec` no longer carries parameterization fields.
- [ ] 6.4 — Verify all spec acceptance criteria are met (walk [spec §Acceptance Criteria](spec.md#acceptance-criteria); link evidence in the close-out PR description).
- [ ] 6.5 — Strip repo-wide references to `projects/codec-model-unification/**` (search via `rg -l 'projects/codec-model-unification'` and replace with canonical `docs/` links or remove).
- [ ] 6.6 — Delete `projects/codec-model-unification/` as part of the close-out PR.
- [ ] 6.7 — Update Linear ticket [TML-2229](https://linear.app/prisma-company/issue/TML-2229): re-scope description to reference this project, link to the merged ADR, mark as done.

## Test Coverage

| Acceptance Criterion | Test Type | Task | Notes |
|---|---|---|---|
| A1: `ParameterizedCodec`/`CodecBrand`/`Apply` exist | Type test (`.test-d.ts`) | 1.1, 1.2 | Fixture brand verified |
| A1: `parameterizedCodec({…})` enforces required fields | Negative type test | 1.3 | Missing `Brand`/`paramsSchema`/`renderOutputType` |
| A2: `paramsSchema` accepts any StandardSchema | Type test | 1.4 | Arktype-backed regression |
| A2: JSON codec infers from user schema | Type test | 2.4, 2.5 | Arktype fixture schema |
| A3: `columnFor(nonParam)` returns descriptor | Unit test | 2.1, 2.2 | Runtime smoke |
| A3: `columnFor(param)(params)` literal-preserves | Type test | 2.3 | `as const` flow |
| A3: `columnFor(param)(badParams)` runtime throws | Unit test | 2.2 | StandardSchema validation |
| A4: `vector(1536)` column → `Vector<1536>` | Type test (`contract-ts/test`) | 3.3 | Headline fix |
| A4: `typeRef: 'Embedding1536'` → `Vector<1536>` | Type test | 3.4 | Indirection through `storage.types` |
| A4: JSON column → schema-inferred type | Type test | 3.5 | Standard Schema path |
| A4: nullability preserved | Type test | 3.6 | `Vector<1536> \| null` |
| A4: non-parameterized columns unchanged | Type test (regression) | 3.7 | `text`, `int4` |
| A4: `ComputeColumnJsType` resolves brand types | Type test (`relational-core`) | 3.8 | Delegates via `ExtractFieldOutputTypes` |
| A5: pgvector migrated | Existing tests pass | 3.1 | Co-located `VectorBrand` |
| A5: postgres core codecs migrated | Existing tests pass | 4.1 | numeric, timestamp, json, jsonb |
| A5: mongo codecs migrated | Existing tests pass | 4.2 | All codecs with `renderOutputType?` |
| A5: column factories replaced with `columnFor` | Existing tests pass | 3.1, 4.1, 4.2 | One per codec |
| A6: base `Codec` loses parameterization fields | Workspace typecheck | 5.1, 5.3 | `pnpm typecheck` |
| A6: `pnpm lint:deps` passes | Lint | 4.6, 5.3 | No layering regression |
| A7: emit-path snapshots unchanged | Existing snapshot tests | 5.3 | `pnpm --filter @prisma-next/emitter-* test` |
| A8: typecheck within ±20% of baseline | Manual measurement | 0.1, 5.5 | `assets/typecheck-baseline.md` |
| A9: pack-author README section | Doc presence | 6.1 | Worked example with pgvector |
| A9: ADR finalized | Doc presence | 6.3 | Extends ADR 186 |
| A9: subsystem doc updated | Doc presence | 6.2 | Codecs + brand + `storage.types`/`typeRef` |

## Open Items

Carried forward from [spec §Open Questions](spec.md#open-questions); each will be resolved during M1 design or in the implementing PR:

1. **Where does `parameterizedCodec()` live?** — framework-components (default) vs SQL-only. Resolve in 1.3.
2. **`codec()` accepting parameterization fields during transition.** — hard cut (default). Confirmed in 5.2.
3. **Brand storage shape.** — declared `readonly Brand` value cast (default) vs phantom `_brand?` slot. Resolve in 1.2.
4. **`columnFor` name.** — keep `columnFor` (default). Confirm in 2.1.
5. **JSON-codec API surface.** — `jsonCodec({ schema })` as typeParam (default) vs `jsonCodec(schema)` direct. Resolve in 2.4.
6. **Docs clarification of `storage.types` vs `typeRef`.** — short paragraph in subsystem doc as part of 6.2.
7. **Runtime-string `renderOutputType` on base `Codec`.** — drop entirely (default). Confirmed in 5.1.

## Close-out (required)

Tracked in M6:

- [ ] 6.4 — Verify all acceptance criteria in [spec.md](spec.md#acceptance-criteria)
- [ ] 6.3 — Finalize ADR under `docs/architecture docs/adrs/`
- [ ] 6.2 — Migrate long-lived docs into `docs/architecture docs/subsystems/`
- [ ] 6.5 — Strip repo-wide references to `projects/codec-model-unification/**`
- [ ] 6.6 — Delete `projects/codec-model-unification/`
- [ ] 6.7 — Update Linear ticket TML-2229
