# Slice: collapse-consumers

_Parent project: [`projects/unify-query-operations/`](../../). This slice satisfies FR6-FR14 from the project spec (the legacy-surface deletions and consumer rewiring; the AC1/AC3/AC4/AC5/AC7/AC9 promises). **Narrowed per operator decision 2026-05-21** — the orderBy callback accessor split + ORM ordering registry are deferred to slice 3b._

## At a glance

Delete `COMPARISON_METHODS_META` (ORM) and `BuiltinFunctions` (sql-builder). Collapse the ORM model accessor's two-loop synthesis to a single registry-driven loop. Drop the `BuiltinFunctions<CT> &` intersection from `Functions<QC>` so the sql-builder `fns` proxy derives purely from `DeriveExtFunctions<QC['queryOperationTypes']>` — which now (post slice 2) includes all 15 family operations. **User-visible result**: `fns.eq(cipherstashCol, cipherstashCol)` fails type-checking on the sql-builder surface (symmetric with the ORM's pre-existing behaviour); the sql-builder's `fns.ne` is renamed to `fns.neq` (the family adopted `neq` to match the ORM's existing wording). **Transient state**: the WHERE-style column accessor still exposes cosmetic `.asc()` / `.desc()` methods through a tiny hand-listed `LEGACY_ORDERING_METHODS` map preserved in `model-accessor.ts` — slice 3b's territory removes the leak by introducing the proper ORM ordering registry and splitting the orderBy callback accessor from WHERE.

## Scope

### In scope

**Deletions:**

- `packages/3-extensions/sql-orm-client/src/types.ts` — delete `COMPARISON_METHODS_META` (lines 309-365), `ComparisonMethodMeta` (lines 284-287), `ComparisonMethodFns` and the related `scalarComparisonMethod` / `listComparisonMethod` / `MethodFactory` definitions (lines 278-301). **Preserve** `ComparisonMethods<T, Traits>` (the public-facing type wrapper at lines ~470-510 — FR13 requires it stays; its trait-filter logic gets re-sourced from the registry).
- `packages/2-sql/4-lanes/sql-builder/src/expression.ts` — delete `BuiltinFunctions<CT>` (lines 62-117). Drop the `BuiltinFunctions<CT> &` intersection from `Functions<QC>` (the resulting type derives purely from `DeriveExtFunctions<QC['queryOperationTypes']>` — FR14).
- `packages/2-sql/4-lanes/sql-builder/src/runtime/functions.ts` — delete `createBuiltinFunctions` (lines 137-161) and the private helpers it owns (`eq`, `ne`, `comparison`, `inOrNotIn`, `binaryWithSharedCodec`, `resolveOperand`, `toLiteralExpr`, `boolExpr` — those exact helpers are now redundant; D2 of slice 2 copied verbatim equivalents into `packages/2-sql/9-family/src/core/query-operations.ts`). Modify the `createFunctions` Proxy (lines 180-195) to perform a single registry lookup (no fall-through to builtins).

**Consumer rewires:**

- `packages/3-extensions/sql-orm-client/src/model-accessor.ts` — collapse the two-loop synthesis in `createScalarFieldAccessor` (lines 138-167). The current shape: loop 1 (lines 149-153) over `COMPARISON_METHODS_META` filtered by codec traits + loop 2 (lines 162-164) over the registry's per-codec index. The new shape: **single loop** over the registry's per-codec index (which now carries the 15 family ops from slice 2). The same collapse applies inside `createExtensionMethodFactory` for non-predicate result-method synthesis (lines 191-196) — the second `COMPARISON_METHODS_META` loop there must read from the registry-and-filter-by-return-codec-traits pattern instead. **Preserve** `asc` / `desc` via a tiny `LEGACY_ORDERING_METHODS` map (~8 LoC) — see § Approach for details.
- `packages/3-extensions/cipherstash/test/equality-trait-removal.test.ts` — update the doc-comment that references `COMPARISON_METHODS_META` (it's a comment, not a code reference; the test itself continues to assert what it asserts).
- `packages/3-extensions/cipherstash/src/execution/operators.ts` — update the doc-comment at line 39 that references `COMPARISON_METHODS_META.eq` to reference the family's `eq` (via the registry) instead. Comment-only change; no behavioural impact.
- `packages/2-sql/9-family/src/core/query-operations.ts` — update doc-comments at lines 15 and 127 that reference the legacy surfaces (D2 wrote these as lowering-parity notes; with the surfaces gone, the comments should describe the family factory as the source of truth rather than the parity destination).

**`fns.ne` → `fns.neq` rename (consumer-side migration):**

The family registers `neq` (matching `COMPARISON_METHODS_META`'s existing wording; slice 2 § Edge cases pinned this). Today's sql-builder publishes `fns.ne`. After this slice, the sql-builder publishes `fns.neq` (sourced from the registry); existing `fns.ne` callers must be renamed.

Files to touch (~11 hits across 5 files, grounded by `rg 'fns\.ne\b'`):

- `packages/2-sql/4-lanes/sql-builder/test/runtime/functions.test.ts` — 2 hits.
- `test/integration/test/sql-builder/subquery.test.ts` — 1 hit.
- `test/integration/test/sql-builder/where.test.ts` — 1 hit.
- `test/integration/test/cli-journeys/invariant-routing.e2e.test.ts` — 4 hits.
- `examples/prisma-next-demo/src/queries/cross-author-similarity.ts` — 3 hits.

Each migration is a mechanical rename `fns.ne(` → `fns.neq(`.

### Out of scope (this slice)

**Slice 3b's territory** (the orderBy accessor split):

- Introducing the private ORM ordering registry with `asc` / `desc` — slice 3b ships this.
- Splitting the `orderBy` callback accessor from the WHERE-style column accessor — slice 3b's `OrderByModelAccessor` lands then.
- Removing the `LEGACY_ORDERING_METHODS` transient map — slice 3b deletes it once the proper ordering registry is wired.
- Narrowing the WHERE accessor's published type to omit `asc` / `desc` — slice 3b.

**Other slices:**

- HAVING surface derivation (delete `HavingComparisonMethods<T>`; derive from registry) — slice 4.
- ADR drafting — slice 5.
- Aggregate-only functions (`count`, `sum`, `avg`, `min`, `max`) — project non-goal (declared in project spec § Non-goals).

## Approach

The slice has three logical workstreams that compose into one PR's diff: **(1) sql-builder cleanup** (delete `BuiltinFunctions`, `createBuiltinFunctions`; rewire the `fns` proxy + `Functions<QC>` type), **(2) ORM model accessor collapse** (single registry loop in `createScalarFieldAccessor` and `createExtensionMethodFactory`; transient `LEGACY_ORDERING_METHODS` map for `asc` / `desc`; delete `COMPARISON_METHODS_META`), **(3) `fns.ne` → `fns.neq` rename** + cipherstash doc-comment updates. The slice plan will decompose these into ~3 M-sized dispatches.

**Transient state for asc/desc** (load-bearing design call):

`asc` / `desc` live in `COMPARISON_METHODS_META` today (lines 349-356, declared with `traits: ['order']`). Slice 2 deliberately excluded them from the SQL family registry — they're slice 3b's territory (the proper ORM ordering registry). If slice 3 deletes `COMPARISON_METHODS_META` outright, orderBy callbacks break.

The transient preservation strategy: introduce a tiny `LEGACY_ORDERING_METHODS` map private to `packages/3-extensions/sql-orm-client/src/model-accessor.ts` (or a sibling file), carrying only `asc` and `desc` and their `OrderByItem.asc` / `OrderByItem.desc` factory closures (copied verbatim from `COMPARISON_METHODS_META`). The model accessor's synthesis loop reads `asc`/`desc` from this map alongside the registry-driven ops. The map is annotated with a "**Removed by slice 3b** — when the ORM ordering registry lands" comment so future readers know it's deliberately transient.

```ts
// Illustrative — placement is the implementer's choice.
// Slice-3b removes this in favour of the proper ORM ordering registry.
const LEGACY_ORDERING_METHODS = {
  asc: { traits: ['order' as const], create: (left: AnyExpression) => () => OrderByItem.asc(left) },
  desc: { traits: ['order' as const], create: (left: AnyExpression) => () => OrderByItem.desc(left) },
} as const;
```

The orderBy callback continues to receive the same `ModelAccessor` shape it does today — `m.field.asc()` / `m.field.desc()` keep working. The cosmetic leak (the WHERE-style accessor also exposes them) is the transient state slice 3b removes by splitting accessors.

**ORM model accessor's two-loop collapse:**

Today's `createScalarFieldAccessor` (model-accessor.ts:138-167) has two synthesis loops:

```ts
// Loop 1: legacy COMPARISON_METHODS_META, filtered by codec traits.
for (const [name, meta] of Object.entries(COMPARISON_METHODS_META)) {
  if (meta.traits.some((t) => !traits.includes(t))) continue;
  comparisonEntries.push([name, meta.create(column, codec)]);
}

// Loop 2: registry's per-codec index (extension + slice-2 family entries).
for (const [name, entry] of operations) {
  accessor[name] = createExtensionMethodFactory(accessor, entry, context);
}
```

After this slice the synthesis collapses to a single loop over the registry's per-codec index, with `LEGACY_ORDERING_METHODS` as a separate fixed-set surface for `asc`/`desc`:

```ts
// Illustrative — single registry-driven loop.
for (const [name, entry] of operations) {
  accessor[name] = createExtensionMethodFactory(accessor, entry, context);
}
// Transient — slice 3b removes when the ORM ordering registry lands.
for (const [name, meta] of Object.entries(LEGACY_ORDERING_METHODS)) {
  if (meta.traits.some((t) => !traits.includes(t))) continue;
  accessor[name] = meta.create(column);
}
```

The same collapse applies inside `createExtensionMethodFactory` (lines 191-196) for non-predicate result-method synthesis. Today: loops over `COMPARISON_METHODS_META` filtered by the *result* codec's traits. After: same logic, but reads from the registry's index by the result codec id (filtered by predicate-return shape, since non-predicate methods on a non-predicate result are chainable comparisons). Implementer must verify that the registry's per-codec index returns the right set for an arbitrary result codec id — slice 2's family ops are indexed per-codec; the operation entries' `impl` signatures take the right argument types.

**sql-builder `Functions<QC>` simplification:**

Today's type at `expression.ts:62-117`:

```ts
// Illustrative.
export type Functions<QC extends QueryContext> = BuiltinFunctions<ExtractCodecTypes<QC>>
  & DeriveExtFunctions<QC['queryOperationTypes']>
  & AggregateFunctions<QC>;
```

After this slice:

```ts
export type Functions<QC extends QueryContext> = DeriveExtFunctions<QC['queryOperationTypes']>
  & AggregateFunctions<QC>;
```

`AggregateFunctions<QC>` stays — it's the aggregate-only surface (`count`/`sum`/`avg`/`min`/`max`). The aggregate-only deletion is a project non-goal.

The `createFunctions` Proxy in `runtime/functions.ts:180-195` likewise simplifies:

```ts
// Today.
export function createFunctions<QC extends QueryContext>(
  operations: Readonly<Record<string, SqlOperationEntry>>,
): Functions<QC> {
  const builtins = createBuiltinFunctions();
  return new Proxy({} as Functions<QC>, {
    get(_target, prop: string) {
      const builtin = (builtins as Record<string, unknown>)[prop];
      if (builtin) return builtin;
      const op = operations[prop];
      if (op) return op.impl;
      return undefined;
    },
  });
}

// After.
export function createFunctions<QC extends QueryContext>(
  operations: Readonly<Record<string, SqlOperationEntry>>,
): Functions<QC> {
  return new Proxy({} as Functions<QC>, {
    get(_target, prop: string) {
      return operations[prop]?.impl;
    },
  });
}
```

**Cipherstash trait tightening (user-visible AC3 win):**

The project spec § Approach explains this as a "deliberate behaviour change, not an accident of the refactor." Today's sql-builder `fns.eq` is parametric over any codec id and any expression — `fns.eq(cipherstashCol, cipherstashCol)` typechecks. After this slice, `fns.eq` derives its argument-type constraint from the registry's `eq` entry, which declares `self: { traits: ['equality'] }`. The trait-constrained codec-id generic resolves to the union of codec ids in `CT` that declare `equality` — cipherstash's `cipherstash/string@1` codec declares `traits: []` (extension-namespaced traits like `cipherstash:equality` don't satisfy the framework-canonical `equality` requirement), so it's not in the union. `fns.eq(cipherstashCol, ...)` becomes a TypeScript error.

The `equality-trait-removal.test.ts` is a cipherstash test that asserts this exact tightening for the ORM side — today it asserts `column.eq` is absent on cipherstash columns because their codec opts out. After this slice, the same tightening applies to the sql-builder surface; the test's narrative gets richer. The test file gets ONE comment update (no test logic change in slice 3 — the test was already correct, just the doc-comment referencing `COMPARISON_METHODS_META` updates).

## Edge cases (Example-Mapping)

| Edge case | Disposition | Notes |
|---|---|---|
| `fns.ne` → `fns.neq` rename across 5 files / ~11 sites | Handle | Mechanical `rg`-based migration. Slice spec lists the call sites exhaustively; the implementer re-runs the grep before declaring done to confirm zero remaining `fns\.ne\(` references. |
| `asc` / `desc` preservation via `LEGACY_ORDERING_METHODS` | Handle | A 4-entry transient map (asc + desc factories) inside `model-accessor.ts`. The comment block says "Removed by slice 3b — proper ORM ordering registry lands then." A grep gate confirms `LEGACY_ORDERING_METHODS` appears in exactly one file (no stray copies). |
| Cipherstash `fns.eq(cipherstashCol, cipherstashCol)` typecheck failure (user-visible AC3) | Handle | Deliberate behaviour change. A new type-level test in the sql-builder package asserts the failure (`// @ts-expect-error`); a positive type-level test asserts `fns.eq(intCol, intCol)` still typechecks. The manual-QA script verifies the developer-experience side (typecheck error message quality, no `any`-cast escape hatch). |
| ORM column accessor surface unchanged for codecs that declare traits (AC4) | Handle | The single-loop synthesis sources its op set from the registry, which (post slice 2) carries the same 15 ops trait-gated per the same trait sets. For any codec declaring `equality + order + textual` (e.g. `pg/text@1`), the per-column method surface is byte-identical. A test fixture exercises a representative codec set and asserts the method surface matches the pre-slice baseline (modulo the deliberate cipherstash tightening). |
| `HavingComparisonMethods<T>` stays in place (slice 4's deletion target) | Explicitly out | Slice 4 deletes it. This slice MUST NOT touch it — intent-validation gate confirms. The Pick<...> type at sql-orm-client/src/types.ts (line ~514) is left as-is. |
| `createExtensionMethodFactory` non-predicate result-method synthesis | Handle | Lines 191-196 today loop over `COMPARISON_METHODS_META`. The collapse replaces this with a registry-driven loop filtered by the result codec's traits. Same trait-filter logic; registry-sourced ops; covers the chained-comparison surface end-to-end. Test: a non-predicate registry-defined operation's return type's `.eq()` method must still work after the slice (existing tests cover this in sql-orm-client). |
| Intent-validation: no edits to `family-sql/**` | Handle | Slice 2 sealed the family. Intent-validation gate confirms `git diff --name-only` shows zero edits under `packages/2-sql/9-family/src/` (except possibly the doc-comment updates at `core/query-operations.ts` lines 15 and 127, which are scoped and trivial). |
| Workspace test regression check (no behaviour change beyond AC3 + the rename) | Handle | The workspace test suite must pass with ZERO modifications EXCEPT the `fns.ne → fns.neq` rename + the cipherstash test's doc-comment. Any new failure that isn't explained by these two changes is a regression that halts the dispatch. SDoD9. |
| Transient `.asc()` / `.desc()` leak on WHERE accessor | Defer | Documented; slice 3b's territory. Manual-QA script for this slice notes the cosmetic leak as a known limitation; users get `m.field.asc()` in WHERE callbacks but it would semantically only be useful in orderBy — same as today. |
| Extensions referencing deleted symbols | Handle | Grounded by `rg`: cipherstash's `execution/operators.ts:39` (doc-comment only — update) and `equality-trait-removal.test.ts` (doc-comment only — update). No extension under `packages/3-extensions/*` references the deleted symbols in code. Adapter packages (`packages/3-targets/*`) confirmed clean by grep. |
| `Functions<QC>` typecheck time (NFR2) | Handle | Removing the `BuiltinFunctions<CT> &` intersection means TypeScript no longer resolves the 13-entry handwritten union; it derives from the registry-driven `DeriveExtFunctions<QC['queryOperationTypes']>` which now has 15 family entries plus any extension entries. The implementer reports `pnpm typecheck` wall-clock before and after on the demo to confirm no regression > a few percent. If it regresses, the project spec's NFR2 mitigation is to investigate shared `infer` slots / distributive conditionals before shipping. |
| Demo + examples migration | Handle | The `examples/prisma-next-demo/src/queries/cross-author-similarity.ts` is in the `fns.ne` migration list. End-to-end `pnpm demo` should still produce identical output after the rename. |
| ORM model accessor's resolution loop preservation | Handle | The two-loop collapse must preserve the existing trait-filtering logic: only expose method `K` on a codec if the codec's `traits` set includes the operation's required traits. This is the AC4 promise. Test: a column with empty traits (e.g., cipherstash-style) shows only the `any: true` ops (`isNull`/`isNotNull` from slice 2) and the `asc`/`desc` ops gated by `traits: ['order']` (so cipherstash empty-traits sees only isNull/isNotNull). |

## Contract impact

**None.** The contract's `queryOperationTypes` slot is unchanged — the family entries from slice 2 remain. The change is purely consumer-side: ORM and sql-builder both source from the registry now. No downstream contract or extension breaks.

Verification: `rg 'queryOperationTypes' packages/3-extensions/cipherstash/src/ packages/3-extensions/pgvector/src/ packages/3-targets/` shows existing extension/adapter usage; the slice does not alter any of these.

## Adapter impact

**Low — verified by grep.** No adapter package (`packages/3-targets/*`) references `COMPARISON_METHODS_META`, `BuiltinFunctions`, `ComparisonMethodFns`, or `createBuiltinFunctions`. Adapters author their own `queryOperations()` factories via the registry pattern; the deletion does not touch their surface.

The only cross-domain reference is from the family's own descriptor-meta and `query-operations.ts` (slice 2 work) which reference the legacy surfaces only in doc-comments — those comment updates land in this slice as housekeeping.

## ADR pointer

Defers to slice 5's close-out ADR ("ADR NNN — Unified SQL-family operation registry"), per the project plan. This slice does not draft a separate ADR; the architectural shift's most user-visible consequence (the cipherstash trait tightening) is documented inline in the close-out ADR alongside slices 1, 2, 3b, and 4.

## Slice Definition of Done

- [ ] **SDoD1.** All "Done when" gates from the slice plan pass: `pnpm typecheck` clean on the expanded 8-package targeted set (`operations`, `sql-contract`, `sql-orm-client`, `cipherstash`, `pgvector`, `family-sql`, `sql-runtime`, `sql-builder`); `pnpm test:packages` workspace-wide green; `pnpm lint:deps` clean; intent-validation confirms diff matches slice scope (no edits to `family-sql` src code beyond doc-comment updates; no edits to `HavingComparisonMethods<T>`; no introduction of the ORM ordering registry — slice 3b's territory).
- [ ] **SDoD2.** Every pre-named edge case handled per its disposition.
- [ ] **SDoD3.** Reviewer verdict: accept on `projects/unify-query-operations/reviews/code-review.md`.
- [ ] **SDoD4.** Manual-QA script in `projects/unify-query-operations/slices/collapse-consumers/manual-qa.md`, with ≥ 1 run report, no unresolved 🛑 Blocker findings. The script targets the extension-author audience primarily (cipherstash tightening), with a single-audience declaration in the script's "What this script is testing" block. Coverage includes: (a) verify `fns.eq(cipherstashCol, cipherstashCol)` produces a typecheck error with a useful diagnostic message; (b) verify `fns.eq(intCol, intCol)` still typechecks; (c) verify the demo's renamed `fns.neq` calls produce byte-identical SQL output to the pre-rename baseline; (d) verify the orderBy callback's `m.field.asc()` still works through `LEGACY_ORDERING_METHODS` (regression check on the transient preservation).
- [ ] **SDoD5.** Slice doesn't touch out-of-scope surfaces. Specifically: no introduction of `OrderByModelAccessor` or any new ORM ordering registry (slice 3b); no deletion of `HavingComparisonMethods<T>` (slice 4); no changes to `family-sql/src/core/`, `family-sql/src/types/`, `family-sql/src/exports/`, `family-sql/src/core/runtime-descriptor.ts`, or `family-sql/src/core/control-descriptor.ts` (slice 2 sealed). Doc-comment updates to `family-sql/src/core/query-operations.ts` lines 15 and 127 ARE in scope (they reference the now-deleted surfaces).
- [ ] **SDoD6.** AC1 (legacy surfaces gone — repo-wide search shows zero production references). The grep gate: `rg '\bCOMPARISON_METHODS_META\b|\bBuiltinFunctions\b|\bComparisonMethodFns\b|\bcreateBuiltinFunctions\b' packages/ examples/ test/` returns ZERO production hits (test files may carry historical references in their own setup; the implementer reports each remaining hit and confirms it's deliberate).
- [ ] **SDoD7.** AC3 (trait gating symmetric). A type-level test asserts `fns.eq(cipherstashCol, cipherstashCol)` fails type-checking. A symmetric positive test asserts `fns.eq(intCol, intCol)` typechecks. Both tests live in `packages/2-sql/4-lanes/sql-builder/test/` (new test-d.ts file or extension of an existing one).
- [ ] **SDoD8.** AC4 (per-column ORM method surface unchanged). The implementer reports the method surface diff per codec (a quick `Object.keys` comparison) across the test contracts — pg core codecs, cipherstash, arktype-json, pg/vector-like. The diff is empty except for cipherstash (which loses `eq`/`neq` per AC3 — already matching the ORM's pre-slice behaviour, so no regression).
- [ ] **SDoD9.** AC9 (end-to-end ORM queries still build and emit correct SQL). The existing query-build integration tests (predicates, ordering, null checks, `in` with lists and subqueries) pass with no modification. The implementer cites the suite's pass count before and after.
- [ ] **SDoD10.** `LEGACY_ORDERING_METHODS` map is in exactly one file (the ORM model accessor) and carries the "removed by slice 3b" comment. A grep gate confirms.
- [ ] **SDoD11.** `fns.ne` is gone from production code. A grep gate `rg 'fns\.ne\b' packages/ examples/ test/` returns zero hits (all renamed to `fns.neq`).

## Open Questions

1. **Where to place `LEGACY_ORDERING_METHODS`?** Working position: inside `packages/3-extensions/sql-orm-client/src/model-accessor.ts` (top of file or a sibling helper file), since it's a model-accessor-internal concern. Alternative: a sibling file `legacy-ordering.ts` to make slice 3b's deletion mechanical. Either is fine; the implementer chooses. The grep gate at SDoD10 enforces "exactly one file."
2. **`LEGACY_ORDERING_METHODS` typing — `MethodFactory` or inlined?** The original `COMPARISON_METHODS_META` typed factories as `MethodFactory` (= `(left: AnyExpression, codec: CodecRef | undefined) => (...args: never[]) => unknown`). When `MethodFactory` is deleted, the `LEGACY_ORDERING_METHODS` map will need its own minimal local type. Working position: inline the factory shape in the map's type literal — fewer indirections, easier to grep-delete in slice 3b. The orderBy factories don't use the `codec` param, so the signature can simplify to `(left: AnyExpression) => () => OrderByItem`.
3. **Cipherstash tightening test placement.** Working position: a new `.test-d.ts` file at `packages/2-sql/4-lanes/sql-builder/test/cipherstash-trait-tightening.test-d.ts` (negative-cipherstash typecheck) + a positive case at `test/fns-trait-gating.test-d.ts` (or extension of an existing test-d.ts in the same package). Implementer may choose to consolidate into a single file. The point is to surface the AC3 promise as a build-time check.
4. **Demo migration risk.** `examples/prisma-next-demo/src/queries/cross-author-similarity.ts` uses `fns.ne` 3 times. Renaming is mechanical, but a `pnpm demo` end-to-end run is part of the manual-QA verification — if the demo produces different output after the rename (it shouldn't — `eq`/`neq` are equivalent), the rename caused a regression. Working position: include the demo run in the manual-QA script.
5. **`NFR2` typecheck-time regression risk.** Removing the `BuiltinFunctions<CT> &` intersection might regress typecheck time. The project spec's mitigation is "shared `infer` slots, distributive conditional types." Working position: measure first; if regression > a few percent on the demo's `pnpm typecheck`, investigate before shipping. The implementer measures and reports.

## References

- Parent project: [`../../spec.md`](../../spec.md) — FR6-FR14, AC1/AC3/AC4/AC5/AC7/AC9. Project plan slice 3 description (narrowed).
- Linear issue: TML-2354 (project-level; no per-slice sub-issue). Per the project plan's amended delivery model (single PR at project close), this slice does not open its own PR.
- Slice 2 (`family-ops-factory`) — closed 2026-05-21 — the dependency that put 15 family ops in the registry for this slice's consumers to read.
- ADR 203 / ADR 206 — referenced by the project spec; the patterns this slice's consumers now read from instead of the deleted surfaces.
- In-repo touchpoints (anchors for the slice plan):
  - `packages/3-extensions/sql-orm-client/src/types.ts:309-365` — `COMPARISON_METHODS_META` (to delete most of).
  - `packages/3-extensions/sql-orm-client/src/types.ts:278-301` — `MethodFactory`, `ComparisonMethodMeta`, `scalarComparisonMethod`, `listComparisonMethod` (to delete).
  - `packages/3-extensions/sql-orm-client/src/types.ts` near line 514 — `HavingComparisonMethods<T>` (PRESERVE — slice 4's territory).
  - `packages/3-extensions/sql-orm-client/src/types.ts` near line 470 — `ComparisonMethods<T, Traits>` (PRESERVE — FR13).
  - `packages/3-extensions/sql-orm-client/src/model-accessor.ts:138-167` (`createScalarFieldAccessor` two-loop) + `:191-196` (`createExtensionMethodFactory` non-predicate loop).
  - `packages/2-sql/4-lanes/sql-builder/src/expression.ts:62-117` — `BuiltinFunctions<CT>` and `Functions<QC>` intersection.
  - `packages/2-sql/4-lanes/sql-builder/src/runtime/functions.ts:137-161` (`createBuiltinFunctions`) + `:180-195` (`createFunctions` Proxy).
  - `packages/3-extensions/cipherstash/test/equality-trait-removal.test.ts` — doc-comment update only.
  - `packages/3-extensions/cipherstash/src/execution/operators.ts:39` — doc-comment update only.
  - `packages/2-sql/9-family/src/core/query-operations.ts:15` + `:127` — doc-comment updates only (slice 2's lowering-parity notes referencing the now-deleted surfaces).
- `fns.ne` migration sites (grounded by `rg 'fns\.ne\b' packages/ examples/ test/`):
  - `packages/2-sql/4-lanes/sql-builder/test/runtime/functions.test.ts` (2 hits)
  - `test/integration/test/sql-builder/subquery.test.ts` (1 hit)
  - `test/integration/test/sql-builder/where.test.ts` (1 hit)
  - `test/integration/test/cli-journeys/invariant-routing.e2e.test.ts` (4 hits)
  - `examples/prisma-next-demo/src/queries/cross-author-similarity.ts` (3 hits)
