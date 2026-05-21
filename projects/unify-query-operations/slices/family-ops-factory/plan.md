# Slice plan: family-ops-factory

**Spec.** [`./spec.md`](./spec.md).
**Parent project.** [`projects/unify-query-operations/`](../../).
**Linear.** TML-2354. Per the project plan's amended delivery model (single PR at project close), this slice does NOT open its own PR; its commits land on the project branch `unify-op-registries`.
**Branch.** `unify-op-registries`.
**Base commit (head before slice 2 starts):** `c40aac5ed` (slice 1 D2 — landed slice-1 SATISFIED).

## Decomposition rationale

Three dispatches. Slicing piece 1 (factory + type twin) into two dispatches — types first, runtime factory second — is what keeps every dispatch comfortably below the M cap.

Estimated LoC and file count if piece 1 shipped as a single dispatch:
- `types/operation-types.ts` (new): ~150-200 LoC for the 15 op signatures + trait-constrained codec-id helper types (`EqualityCodecId<CT>` / `OrderCodecId<CT>` / `TextualCodecId<CT>`).
- `core/query-operations.ts` (new): ~200-300 LoC for 15 op impls using `buildOperation`, with TypeScript overloads on `in` / `notIn` (FR16).
- `exports/operation-types.ts` (new): ~5-10 LoC barrel re-export.

Total: ~350-500 LoC across 3 new files — over the M ceiling (~200 LoC). The natural semantic joint is **types-then-impl**: once the `QueryOperationTypes<CT>` type exists, the runtime factory can use `satisfies QueryOperationTypes<CT>` to enforce lock-step, and the type twin can be reviewed independently of the lowering choices.

The remaining work (descriptor-meta wiring + `createExecutionContext` extension + tests) is naturally a single M dispatch carrying ~250-350 LoC, but **splitting the descriptor wiring from the runtime wiring** lets D2 leave the family descriptor self-describing-but-not-yet-wired-into-the-runtime — a clean stable state where the type twin is satisfied by the impls, the descriptor declares its operation-types intent, but the runtime hasn't yet pulled the family into its contributors loop. D3 then flips the switch (contributor extension + tests) and verifies the end-to-end emitter + runtime integration.

## Dispatches

### Dispatch 1: Type twin — `QueryOperationTypes<CT>` + codec-id helpers

**Intent.** Ship the type-only twin for the family operations factory at `packages/2-sql/9-family/src/types/operation-types.ts`. Define `QueryOperationTypes<CT extends CodecTypesBase>` with 15 entries (`eq`, `neq`, `in`, `notIn`, `gt`, `gte`, `lt`, `lte`, `like`, `isNull`, `isNotNull`, `and`, `or`, `exists`, `notExists`) per the slice spec § Approach trait-mapping table. Define trait-constrained codec-id helper types (`EqualityCodecId<CT>` / `OrderCodecId<CT>` / `TextualCodecId<CT>`) that resolve to the union of CT codec ids whose `traits` set includes the relevant trait — same pattern as ADR 203's "How matching works" for `fns.ilike`. Add a small `exports/operation-types.ts` barrel re-export so downstream consumers can `import type { QueryOperationTypes } from '@prisma-next/family-sql/operation-types'`. **What stays the same.** No runtime code yet; no descriptor wiring; the type twin is dead code at the type level until D2's factory references it (`satisfies QueryOperationTypes<CT>`).

**Files in play.**

- `packages/2-sql/9-family/src/types/operation-types.ts` — NEW. ~150-200 LoC. The 15 type entries + 3 helper types.
- `packages/2-sql/9-family/src/exports/operation-types.ts` — NEW. ~5-10 LoC. Barrel: `export type { QueryOperationTypes } from '../types/operation-types';`.
- `packages/2-sql/9-family/package.json` — MODIFIED. Add the `./operation-types` subpath export (mirroring the existing `./pack`, `./runtime`, `./control` etc. entries). Read the existing `exports` map and follow its format precisely.

**"Done when" gates.**

- [ ] `pnpm --filter @prisma-next/family-sql typecheck` — clean. The new types must structurally satisfy ADR 203's expected shape (each `self` is `{ codecId }` / `{ traits }` / no-self per the trait-mapping table; each `impl` has a valid function signature).
- [ ] `pnpm --filter @prisma-next/family-sql build` — clean (must produce the new `dist/operation-types.*` artifacts the subpath export references).
- [ ] 5-package targeted typecheck: `pnpm --filter @prisma-next/operations --filter @prisma-next/sql-contract --filter @prisma-next/sql-orm-client --filter @prisma-next/extension-cipherstash --filter @prisma-next/extension-pgvector typecheck` — clean. The targeted set was orchestrator-accepted in slice 1 as the workspace-typecheck substitute (see `projects/unify-query-operations/reviews/code-review.md § Orchestrator notes`). For slice 2, also include `pnpm --filter @prisma-next/family-sql typecheck` separately.
- [ ] `pnpm lint:deps` — clean (the new file's imports must respect layering; `types/` only depends on `@prisma-next/sql-relational-core/expression` and similar `2-sql/1-core/*` packages).
- [ ] Intent-validation: `git diff --name-only HEAD` shows only the three files named above. No edits to `core/query-operations.ts` (doesn't exist yet; D2's territory), no edits to `core/runtime-descriptor.ts` or `core/control-descriptor.ts` (D2's territory), no edits to `packages/2-sql/5-runtime/` (D3's territory).
- [ ] No-transient-IDs grep over the `+` diff per `agents/implementer.md § No transient project IDs in code`.
- [ ] Edge cases from slice spec covered by this dispatch: "FR17 binary-operator signatures use trait-constrained codec-id generics" (the three helper types embody this); "lock-step between runtime factory and type alias" (the type twin is now authored — D2's factory will `satisfies` against it); "type-level helper naming (OQ4)" — adopted as `EqualityCodecId<CT>` / `OrderCodecId<CT>` / `TextualCodecId<CT>` per spec.

**Size.** M. Three files; ~150-200 LoC concentrated in one of them; one design judgment (helper-type construction shape); blast radius confined to the family-sql package's published type surface.

**Model tier.** Sonnet (mid tier). Mechanical extension following ADR 203 (`fns.ilike` pattern) and ADR 206 (`QueryOperationTypes<CT>` pattern from pgvector / cipherstash). The implementer derives the helper types by filtering CT keys whose `traits` include the relevant trait — that's one type-level pattern repeated three times.

**DoR confirmed.** ✓ Spec exists; intent stated; files-in-play named; "done when" binary; size M; failure modes considered (F3 not relevant — discovery is done in the spec; F5 destructive-git standard prohibition); edge cases mapped; affected packages identified (family-sql only); no fixture regen (no IR/emitter/serialiser change); no downstream package adds new public types this dispatch (the operation-types are published but no consumer types-against them until D2's factory satisfies). Naming OQ4 pre-resolved in spec.

### Dispatch 2: Runtime factory + descriptor-meta wiring

**Intent.** Ship `sqlFamilyOperations<CT>()` at `packages/2-sql/9-family/src/core/query-operations.ts` with all 15 op impls following the pattern at `packages/3-extensions/pgvector/src/core/descriptor-meta.ts:17-58`. Each impl uses `buildOperation` (or the same AST-construction helpers — `BinaryExpr`, `NullCheckExpr`, `AndExpr`, `OrExpr`, `ExistsExpr`, `ListExpression`) and lowers to byte-identical SQL relative to today's `BuiltinFunctions` (sql-builder) / `COMPARISON_METHODS_META` (ORM). The factory's return type uses `satisfies QueryOperationTypes<CT>` from D1's type twin (lock-step verification). Extend `sqlRuntimeFamilyDescriptor` in `core/runtime-descriptor.ts` with `codecs: () => []` and `queryOperations: () => sqlFamilyOperations()` so the descriptor satisfies `SqlStaticContributions`. Extend `SqlFamilyDescriptor` in `core/control-descriptor.ts` with `types.queryOperationTypes` pointing at the family's own `operation-types` export (D1's barrel). **What stays the same.** `createExecutionContext` still iterates only `[stack.target, stack.adapter, ...stack.extensionPacks]` — the family's `queryOperations` is registered as a descriptor field but not yet **invoked** by the runtime. The emitter's `extractQueryOperationTypeImports` does already iterate `family` in `allDescriptors`, so the emitted contract WILL pick up the family's `QueryOperationTypes` from this dispatch onward — but no end-to-end emitter test fires until D3 sets up the assertion.

**Files in play.**

- `packages/2-sql/9-family/src/core/query-operations.ts` — NEW. ~200-300 LoC. The 15 op impls + `satisfies QueryOperationTypes<CT>` lock-step.
- `packages/2-sql/9-family/src/core/runtime-descriptor.ts` — MODIFIED. ~5-10 LoC added. `codecs: () => []` + `queryOperations: () => sqlFamilyOperations()`. The existing `Object.freeze(sqlRuntimeFamilyDescriptor)` call at line 23 must continue to work (the additions are still on a frozen object literal).
- `packages/2-sql/9-family/src/core/control-descriptor.ts` — MODIFIED. ~10-15 LoC added. New `readonly types = { queryOperationTypes: { import: { package: '@prisma-next/family-sql/operation-types', named: 'QueryOperationTypes', alias: 'SqlFamilyQueryOperationTypes' } } }` field on `SqlFamilyDescriptor`. Mirror the typing pattern at `packages/3-extensions/pgvector/src/core/descriptor-meta.ts:97-103`.

**"Done when" gates.**

- [ ] `pnpm --filter @prisma-next/family-sql build` — clean.
- [ ] `pnpm --filter @prisma-next/family-sql typecheck` — clean. **Specifically**, the `sqlFamilyOperations<CT>()` factory must `satisfies QueryOperationTypes<CT>` (lock-step enforced).
- [ ] `pnpm --filter @prisma-next/family-sql test` — green. Existing family-sql tests unchanged; this dispatch adds no new tests (D3's territory).
- [ ] 5-package targeted typecheck (+ family-sql) — clean.
- [ ] `pnpm lint:deps` — clean. The new `core/query-operations.ts` imports from `@prisma-next/sql-relational-core/expression` and `@prisma-next/sql-relational-core/ast` for AST node constructors; no upward dependency violation.
- [ ] **Lowering parity check (manual)** — the implementer compares the family factory's `impl`s against `BuiltinFunctions` impls in `packages/2-sql/4-lanes/sql-builder/src/runtime/functions.ts:137-161` and `COMPARISON_METHODS_META` factories at `packages/3-extensions/sql-orm-client/src/types.ts:289-378` to confirm AST output parity. Document the per-op comparison in the implementer report (e.g. "family `eq` builds `BinaryExpr.eq(...)` — same shape as `COMPARISON_METHODS_META.eq.create` line N").
- [ ] Intent-validation: `git diff --name-only HEAD` shows only the three files named above. No edits to `packages/2-sql/5-runtime/src/sql-context.ts` (D3's territory). No edits to ORM model accessor, sql-builder runtime, `COMPARISON_METHODS_META`, or `BuiltinFunctions`.
- [ ] No-transient-IDs grep.
- [ ] Edge cases from slice spec covered by this dispatch: "in/notIn TypeScript overloads (FR16)" (the impls + their type signatures carry the overloads); "and/or/exists/notExists with no self" (registered with no `self` field; impl uses `AndExpr.of` / `OrExpr.of` / `ExistsExpr.exists` / `ExistsExpr.notExists`); "isNull/isNotNull using D1's any:true arm" (impls use `NullCheckExpr.isNull` / `NullCheckExpr.isNotNull`; `self: { any: true }` declared); "lock-step between runtime factory and type alias" (the `satisfies` constraint enforces it at compile time); "family currently has no descriptorMeta slot — adding types.queryOperationTypes is new surface" (the control-descriptor extension lands here, additive); "family runtime descriptor needs codecs() returning []" (added as part of the `SqlStaticContributions` satisfaction).

**Size.** M. Three files; ~250-350 LoC; one design judgment (lowering shape parity, but the implementer has direct references to copy from); blast radius confined to family-sql.

**Model tier.** Opus (orchestrator tier). 15 operations is enough volume that the implementer benefits from careful reasoning about lowering parity, overload signatures (`in`/`notIn`), and `satisfies QueryOperationTypes<CT>` constraint resolution. The cost is worth it because a lowering mistake on any op would surface as a slice-3 test failure or — worse — a silent SQL-emission regression.

**DoR confirmed.** ✓ Spec exists; D1 (type twin) must be SATISFIED first (dependency); intent stated; files-in-play named; "done when" binary including the manual lowering-parity check; size M; failure modes considered (F2 — no optional-field magic in impls; F3 — discovery already done; F5 — destructive-git prohibition); edge cases mapped (six from slice spec covered here); affected package = family-sql; no fixture regen; no downstream package adds new public types beyond what D1 already published; lowering parity (OQ3) — working position is "copy AST node choices from BuiltinFunctions/COMPARISON_METHODS_META verbatim."

### Dispatch 3: `createExecutionContext` contributor extension + integration tests

**Intent.** Extend `SqlExecutionStack` at `packages/2-sql/5-runtime/src/sql-context.ts:124-128` with `readonly family: SqlRuntimeFamilyDescriptor` (referencing the type that's part of `@prisma-next/family-sql`). Extend `createSqlExecutionStack` to accept an optional `family?` input and default it to `sqlRuntimeFamilyDescriptor` (importing from the family package). Extend `createExecutionContext`'s contributors array at lines 766-770 to `[stack.family, stack.target, stack.adapter, ...stack.extensionPacks]` — the family becomes the first contributor so the family's codec contribution (empty) and queryOperations are visited first; this is documentational, not functional (the ordering doesn't matter at runtime — codec uniqueness and operation registration are commutative). Add a new test file `packages/2-sql/9-family/test/query-operations.test.ts` covering: (a) direct registry probe — `context.queryOperations.entries()` contains all 15 family op names; (b) trait-gated per-codec index — `eq` indexes under `pg/int4@1` (declares `equality`) but NOT under cipherstash's `cipherstash/string@1` (declares no traits); (c) `any: true` per-codec index — `isNull` indexes under EVERY codec including cipherstash; (d) no-self ops not surfacing — `and` is in the registry but not on any codec's per-column index; (e) emitter integration — emit a fixture contract for a stack with default `sqlRuntimeFamilyDescriptor` + postgres adapter and assert the generated `contract.d.ts` `QueryOperationTypes` alias is the intersection of `SqlFamilyQueryOperationTypes<CodecTypes>` and `PgAdapterQueryOps<CodecTypes>`. **What stays the same.** No edit to `COMPARISON_METHODS_META`, `BuiltinFunctions`, the ORM model accessor, the sql-builder `fns` proxy. The legacy surfaces remain primary; the family entries are inert backups. Every existing test in the workspace continues to pass without modification.

**Files in play.**

- `packages/2-sql/5-runtime/src/sql-context.ts` — MODIFIED. ~10-20 LoC. (1) Extend `SqlExecutionStack` (line 124-128) with `readonly family: SqlRuntimeFamilyDescriptor`; (2) extend `createSqlExecutionStack` (line 166-180) with `family?` optional input defaulting to `sqlRuntimeFamilyDescriptor`; (3) extend the contributors array at line 766-770. Import the family descriptor from `@prisma-next/family-sql/runtime`.
- `packages/2-sql/9-family/test/query-operations.test.ts` — NEW. ~200-300 LoC. Five test groups per the intent above.

**"Done when" gates.**

- [ ] `pnpm --filter @prisma-next/family-sql build` — clean.
- [ ] `pnpm --filter @prisma-next/sql-runtime build` — clean. **New** check this dispatch — D3 is the first dispatch touching `@prisma-next/sql-runtime` in this slice.
- [ ] `pnpm typecheck` for the 5-package targeted set + `@prisma-next/sql-runtime` + `@prisma-next/family-sql` — clean. The `SqlExecutionStack` extension widens the type; existing `createSqlExecutionStack` callers (~8 sites — `postgres.ts`, `sqlite.ts`, test helpers, `runtime-helpers.ts`, etc.) continue to typecheck because `family` is optional.
- [ ] `pnpm --filter @prisma-next/family-sql test` — green. The new test file passes all five test groups.
- [ ] **Workspace-wide test suite (sql-orm-client + sql-runtime + postgres + sqlite extensions + cipherstash + pgvector)** — green. This is the SDoD9 ("no regression") verification. The full set: `pnpm --filter @prisma-next/sql-runtime --filter @prisma-next/sql-orm-client --filter @prisma-next/extension-postgres --filter @prisma-next/extension-sqlite --filter @prisma-next/extension-cipherstash --filter @prisma-next/extension-pgvector test`. Every test must pass without modification.
- [ ] `pnpm lint:deps` — clean. `sql-runtime` now imports from `@prisma-next/family-sql/runtime` (the default family descriptor); confirm this is an allowed layering relationship per `architecture.config.json`.
- [ ] **F3 verification grep** — `rg 'createSqlExecutionStack\(' packages/` returns the same set of call sites as the slice spec named (~8 sites). If a new call site appeared (e.g. a new test added in slice 1 or between dispatches), inspect it to confirm it still compiles with `family?` optional. Document the count in the implementer report.
- [ ] Intent-validation: `git diff --name-only HEAD` shows only the two files named above. No edits to D1/D2 files (`types/operation-types.ts`, `core/query-operations.ts`, `core/runtime-descriptor.ts`, `core/control-descriptor.ts` — frozen after D2). No edits to ORM model accessor, sql-builder runtime, `COMPARISON_METHODS_META`, `BuiltinFunctions`.
- [ ] No-transient-IDs grep.
- [ ] Edge cases from slice spec covered by this dispatch: "registering all 15 ops without collision against existing extension ops" (the registry test asserts the 15 entries exist alongside cipherstash + pgvector entries with no collision); "trait expansion cost" (the per-codec index test exercises the trait expansion path explicitly); "emitter alias-aggregation picking up family operationTypes" (the emitter integration test); "inert-backup state" (the workspace-wide test pass asserts no behavior change to existing consumers); "cipherstash columns with traits:[] must NOT gain family ops they don't declare traits for" (the per-codec index test asserts this for cipherstash); "createSqlExecutionStack callers continue to work without family arg" (the F3 grep + workspace test pass jointly verify); "workspace typecheck substitution carries from slice 1" (the 5-package targeted set + family-sql + sql-runtime is the substitute); "implementer might be tempted to delete legacy surfaces" (intent-validation gate catches it).

**Size.** M. Two files; ~200-300 LoC concentrated in the test file; one design touchpoint (the default-family wiring); blast radius reaches `@prisma-next/sql-runtime` for the first time in this slice, so the cross-package typecheck and workspace test pass are load-bearing gates.

**Model tier.** Sonnet (mid tier). The sql-context.ts changes are small and pattern-following (extending an existing array, adding a default-typed field). The tests are mechanical assertions against a registry the implementer has already built (D2). Opus-tier reasoning isn't needed.

**DoR confirmed.** ✓ Spec exists; D2 (factory + descriptor wiring) must be SATISFIED first (dependency — D3's tests assert against D2's factory output, and the contributors array references the family's queryOperations slot that D2 added); intent stated; files-in-play named; "done when" binary including the workspace-wide regression check; size M; failure modes considered (F3 — re-grep createSqlExecutionStack call sites to confirm no surprises since slice 1; F5 — destructive-git prohibition); edge cases mapped (eight from slice spec covered here); affected packages = sql-runtime + family-sql; downstream `pnpm typecheck` is workspace-wide via the 5-pkg substitute + family-sql + sql-runtime; cross-package gate satisfied (sql-runtime is a public-export package consumed by every adapter / extension that calls createSqlExecutionStack).

## Dependencies between dispatches

Sequential stack: D1 → D2 → D3. Dependencies:

- D2 depends on D1: D2's factory uses `satisfies QueryOperationTypes<CT>` which requires the type twin to exist.
- D3 depends on D2: D3's tests assert against `context.queryOperations.entries()` which only contains family ops after D2's `runtime-descriptor.ts` extension AND D3's contributors-array extension fire. D3's emitter integration test also asserts `Contract['queryOperationTypes']` contains `SqlFamilyQueryOperationTypes` — that depends on D2's `control-descriptor.ts` extension exposing the `types.queryOperationTypes` slot.

No parallelization opportunity within this slice.

## Cross-references

### Failure modes threaded

- [F2 — Constructor magic for optional fields](../../../../drive/calibration/failure-modes.md#f2-constructor-magic-for-optional-fields). Not directly relevant in this slice (no constructor on the surfaces touched). Worth noting because the `family?: SqlRuntimeFamilyDescriptor` optional with a default in `createSqlExecutionStack` is a related shape — but it's the right shape here (default is correct because there's only one SQL family today; future polymorphism YAGNI per spec OQ1).
- [F3 — Discovery via test suite instead of grep](../../../../drive/calibration/failure-modes.md#f3-discovery-via-test-suite-instead-of-grep). D2 implementer threads this for "discover which AST node constructors `BuiltinFunctions` uses for each op" — use `rg` on the BuiltinFunctions impls, not test-the-emitted-SQL-iteratively. D3 implementer threads this for "discover which `createSqlExecutionStack` callers exist" — re-grep against the slice-spec snapshot.
- [F5 — Destructive git operations](../../../../drive/calibration/failure-modes.md#f5-destructive-git-operations-executed-by-subagents-without-orchestrator-approval). Standard non-negotiable disposition in all three dispatches.

### Grep library entries

- `rg ': any\b|\bany\[\]'` — forbidden TypeScript-`any` check. The slice's `any: true` field name is not the TypeScript-`any` type; the lint must distinguish. The existing operations registry test in slice 1 uses property-literal `any: true` and passes the lint, confirming the distinction holds.
- `rg 'createSqlExecutionStack\(' packages/` — D3 gate to verify the call-site set is the same as the slice-spec snapshot (~8 sites).
- `rg 'satisfies QueryOperationTypes' packages/2-sql/9-family/` — D2 verification that the lock-step constraint is present (a missing `satisfies` would allow the runtime factory to drift from the type twin).
- Pre-flight grep for D2: `rg 'BinaryExpr|NullCheckExpr|AndExpr|OrExpr|ExistsExpr|ListExpression' packages/2-sql/4-lanes/sql-builder/src/runtime/functions.ts packages/3-extensions/sql-orm-client/src/types.ts` — surfaces the AST node imports the family factory will need.

## Slice-DoD reachability

Every condition in the slice-DoD is covered by one or more dispatches:

| Slice-DoD condition | Covered by |
|---|---|
| **SDoD1.** All gates pass (build, test, typecheck, lint:deps, intent-validation). | All three dispatches contribute; final pass on D3. |
| **SDoD2.** Every pre-named edge case handled per its disposition. | Distributed per the edge-cases-covered tables in each dispatch. |
| **SDoD3.** Reviewer verdict accept. | D3's reviewer round is the slice-level verdict. |
| **SDoD4.** Manual-QA N/A (declared in spec). | Pre-accepted; no per-dispatch verification needed. |
| **SDoD5.** No out-of-scope touches. | Intent-validation gate in each dispatch. |
| **SDoD6.** `Contract['queryOperationTypes']` includes family's 15 op names at the type level. | D2 establishes the descriptor slot; D3's emitter integration test asserts it. |
| **SDoD7.** `context.queryOperations.entries()` contains the 15 family op names at runtime. | D3's direct registry probe test. |
| **SDoD8.** Trait gating verified at registry-assembly time. | D3's per-codec index tests (trait-gated, `any: true`, no-self). |
| **SDoD9.** No regression in existing tests. | D3's workspace-wide test run. |

## Risks

1. **D2 lowering parity drift.** The family factory's `impl`s must produce byte-identical AST nodes to today's `BuiltinFunctions` and `COMPARISON_METHODS_META` for slice 3's deletion to be a no-op on emitted SQL. The D2 "done when" gate includes a **manual lowering-parity check** (the implementer reports per-op AST shape comparison). If the implementer drifts an impl (e.g. uses a different `BinaryExpr` constructor variant than today's), slice 3 will surface byte-different SQL emission and require rework. Mitigation: spec OQ3 documents the working position ("copy AST node choices verbatim"); the slice plan's D2 brief restates it. Risk contained but real.
2. **D3 `lint:deps` failure on the new `sql-runtime` → `family-sql/runtime` import.** `@prisma-next/sql-runtime` imports from `@prisma-next/family-sql/runtime` for the first time in D3. Layering in `architecture.config.json` may forbid this (runtime → family direction). If `lint:deps` flags it, the wiring shape needs revisiting — possible alternative: invert the dependency by having the family pack consume `createExecutionContext` rather than the other way around (but that changes the architectural shape more fundamentally). Mitigation: pre-flight check `architecture.config.json` for `sql-runtime` allowed dependencies; if `family-sql` isn't there, surface as a stop-condition for orchestrator decision (likely outcome: amend `architecture.config.json` to allow it, given the family is the layer above sql-runtime in the project's mental model).
3. **D3 workspace-wide regression check expense.** Running the full workspace test suite is expensive (multi-minute). The D3 implementer should run it **once** at end-of-round per `agents/implementer.md § Test execution discipline`, not iteratively. WIP inspection cadence: a single ~5-10 min test-suite run is acceptable for D3's wall-clock budget.
4. **Family descriptor's optional `family?` default — silently masking missing-family bugs.** If a future call site forgets to pass `family` (or passes `undefined`), the default `sqlRuntimeFamilyDescriptor` activates silently. For slice 2 this is by design (the call-site fanout cost would dominate the slice's LoC). Mitigation: document the default explicitly in `createSqlExecutionStack`'s JSDoc (D3 implementer adds it); slice 5's close-out ADR records the YAGNI rationale.
5. **The 5-package targeted typecheck might not catch all consumers.** Slice 1 substituted the workspace typecheck with a 5-package set; slice 2 expands it (+ family-sql + sql-runtime). The remaining cli / postgres / family-sql cascaded failures are still pre-existing and orthogonal. If slice 2's changes accidentally regress cli or postgres typechecks, the substitution would miss it. Mitigation: D3 implementer attempts a workspace-wide typecheck once and reports the failure mode — if the failures are the same as slice 1's documented set, the substitution holds; if any new failures appear, halt and surface to the orchestrator.
