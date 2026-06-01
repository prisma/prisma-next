# Brief: D5 — MTI variant-field `where`: variant-aware predicate accessor

## Task

Make a variant-specific `where` referencing an **MTI** variant column work on a polymorphic include
refinement — both at the type level and at runtime. Today
`db.orm.Project.include('tasks', t => t.variant('Feature').where(x => x.priority.gte(3)))` throws
`TypeError: Cannot read properties of undefined (reading 'gte')` because the predicate accessor
(`createModelAccessor(context, modelName)`, `model-accessor.ts:40`) resolves fields against the
**base** table only (`resolveColumn(contract, baseTable, …)`), and an MTI variant column (`priority`)
lives on the joined variant table (`features`), not the base table. STI variant columns live on the
base table, so the STI case already works (and is integration-tested in D4). D1 already inner-joins
the selected variant's table into the child SELECT, so the variant table IS in scope in the emitted
SQL — the gap is purely that the predicate builder can't *name* the variant column.

Make the accessor variant-aware: when the collection state has a selected `variantName` and a field
belongs to that variant (not the base), resolve it to a `ColumnRef` qualified against the **variant
table** (e.g. `features.priority`), so the emitted `where` references the joined variant table. Reuse
the merged field→column knowledge that already exists — `getMergedColumnToFieldMap` in
`collection-runtime.ts` (and the mutation-path merged map around `collection.ts:1274`) — adapting it
to yield `{ table, column }` for the predicate builder rather than a flat field→column map.

## Scope

**In:**
- `model-accessor.ts` (and the minimal `where`-binding plumbing it feeds) — make field resolution
  variant-aware when `state.variantName` is set: variant-owned fields resolve to a `ColumnRef` on the
  variant table; base fields keep resolving to the base table. Thread the selected variant + its
  `PolymorphismInfo` to the accessor (it currently gets only `modelName`).
- The **type** side: inside `t.variant('X').where(predicate)`, the predicate accessor must expose
  variant `X`'s fields (so `x.priority` type-checks for a Feature variant). Mirror how `.variant()`
  narrows elsewhere; if the predicate-accessor row type is independent of D3's result-type narrowing,
  narrow it here too.
- Tests-first: unit coverage that the predicate for a selected MTI variant resolves the variant
  column to a variant-table `ColumnRef` (and base columns stay base-qualified); a type-level test that
  `t.variant('Feature').where(x => x.priority…)` type-checks and `x` carries the variant's fields.
- Extend the D4 integration test (`test/integration/test/sql-orm-client/polymorphism-include.test.ts`)
  with the **MTI** variant-`where` case (`.variant('Feature').where(x => x.priority.gte(N))`) on
  PGlite, asserting it filters correctly — the runtime confirmation that closes AC-3.

**Out:**
- The SQL **join** emission (D1) — the variant table is already joined; do not change `query-plan-select.ts`'s join logic. You may need to confirm the `where` clause lands inside the child correlated SELECT where the join is in scope; if it doesn't, that's a halt-and-surface (a D1 gap), not a join-logic change here.
- The decode path (D2), the `.variant()` result-type narrowing (D3 — already done), the integration fixture/seed shape (D4 — reuse it).
- Non-variant `where` behavior must be byte-for-byte unchanged (no regression to the overwhelmingly common base-table predicate path). This is the top risk — guard it.
- SQLite (deferred — design-notes D4).

## Completed when

- [ ] `t.variant('X').where(x => <variant-column>…)` type-checks (predicate accessor exposes variant `X`'s fields) and resolves the variant column to a variant-table `ColumnRef` at runtime.
- [ ] Base-table predicates and non-variant queries are unchanged (regression guard — unit test or explicit reasoning).
- [ ] New unit + type tests (written first) pass; the D4 integration test gains a passing MTI variant-`where` case on PGlite.
- [ ] Validation gate green (below).

## Standing instruction

Stay focused on the goal; control scope. Tests-first. The top risk is regressing the base predicate
path — keep variant-awareness strictly gated on `state.variantName` being set. If the fix requires
reshaping `where`-binding internals used broadly across the ORM (beyond the variant gate), surface the
blast radius before committing. If the `where` clause turns out NOT to be emitted inside the child
correlated SELECT (so the variant table isn't in scope for it), HALT and surface — that's a D1 gap.

## References

- Slice spec: `projects/tml-2683/spec.md` — the amended variant-`where` scope bullet + slice-DoD.
- Design notes: `projects/tml-2683/design-notes.md` § D3 (the discovery + mechanism + the mutation-path merged-map precedent).
- Slice plan: `projects/tml-2683/plan.md` § Dispatch 5.
- The throwing path: `collection.ts` `.variant()` (`:296`), `model-accessor.ts` (`createModelAccessor`, `resolveColumn` `:88`, `:114`), `collection-runtime.ts` (`getMergedColumnToFieldMap`), `collection-contract.ts` (`resolvePolymorphismInfo`).
- D4 integration test to extend: `test/integration/test/sql-orm-client/polymorphism-include.test.ts` (the STI variant-`where` case is the pattern to mirror for MTI).
- D1 join emission (read-only context): `query-plan-select.ts` `buildMtiJoins` / `buildChildPolymorphismArtifacts` + `buildStateWhere`.
- Implementer persona: `skills-contrib/drive-dispatch/agents/implementer.md`.

## Operational metadata

- **Model tier:** orchestrator-grade (opus) — src change across accessor + where-binding + types, with a sharp regression-risk on the base predicate path.
- **Validation gate (run once, at end):**
  - `pnpm --filter @prisma-next/sql-orm-client typecheck`
  - `pnpm --filter @prisma-next/sql-orm-client test` (incl. the type tests)
  - the extended integration test on PGlite (rebuild `@prisma-next/sql-orm-client` first — the integration package imports `dist`; or run via the suite's build-aware path); report the exact command
  - `pnpm lint:deps`
- **Halt conditions:** the `where` isn't emitted inside the child SELECT (D1 gap); the variant-aware change can't be gated cleanly and risks the base predicate path; the predicate-accessor type narrowing requires a broad reshape; diff exceeds ~8 files.
- **Heartbeats:** `wip/heartbeats/implementer.txt`. **Commit hygiene:** explicit staging; never push; never amend without authorization.
