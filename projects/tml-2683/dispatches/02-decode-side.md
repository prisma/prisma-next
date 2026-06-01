# Brief: D2 — Decode side: map poly child rows to their variant

## Task

In `packages/3-extensions/sql-orm-client/src/collection-dispatch.ts`, make `decodeIncludePayload`
map polymorphic-target included child rows to their correct variant shape. Today (row branch,
after the scalar/combine short-circuits) it calls
`mapStorageRowToModelFields(contract, include.relatedModelName, childRow)` — and
`include.relatedModelName` is the **base** model (it resolves from `relation.to`), so STI child
rows come back base-shaped (variant fields dropped/mis-mapped) and MTI child rows lack their
variant columns. Change it to: resolve `resolvePolymorphismInfo(contract, include.relatedModelName)`
**once per include** (not per row), and when the related model is polymorphic, map each child row
via `mapPolymorphicRow(contract, include.relatedModelName, polyInfo, childRow, include.nested.variantName)`;
otherwise keep `mapStorageRowToModelFields`. This is the decode half of the parent↔child symmetry —
the parent dispatchers already call `mapPolymorphicRow` for parent rows.

D1 (already merged on this branch) made the SQL side emit the discriminator column, STI variant
columns, and MTI `variant_table__column`-aliased columns into the child rows — so the data
`mapPolymorphicRow` needs is present in `childRow`. `mapPolymorphicRow` reads the discriminator from
`row[polyInfo.discriminatorColumn]` and merges base + `variant_table__column` cells via
`getMergedColumnToFieldMap` (see `collection-runtime.ts`).

## Scope

**In:**
- `collection-dispatch.ts` — `decodeIncludePayload` row branch. Resolve poly info once per include;
  branch the per-row mapper. Preserve the existing nested-include recursion and the scalar/combine
  branches unchanged. Keep the empty-relation / `coerceSingleQueryIncludeResult` handling intact.
- `test/collection-dispatch.test.ts` — **write tests first**. Construct raw include payloads (the
  parsed child-row JSON the SQL side produces: base cols + discriminator + `variant_table__column`
  cells) and assert the decoded rows are shaped per their variant — STI rows decode by discriminator
  to the right variant fields; MTI rows surface variant columns under their model field names; a
  variant-narrowed include (`nested.variantName` set) maps to the named variant. Reuse the poly
  contract builders in `test/helpers.ts` (extended by D1).

**Out:**
- The SQL builder (`query-plan-select.ts`) — D1 owns it; do not touch it.
- The public `.variant()` refinement type surface / result-type narrowing — D3. You may read
  `include.nested.variantName`; do not add the `.variant()` operator to the refinement type.
- Integration tests / DB fixtures — D4.

## Completed when

- [ ] `decodeIncludePayload` maps poly-target child rows via `mapPolymorphicRow`, resolving poly info
      once per include; non-poly includes are unchanged (`mapStorageRowToModelFields`).
- [ ] Nested-include recursion, scalar, and combine branches behave exactly as before for non-poly
      relations (no regression).
- [ ] New `test/collection-dispatch.test.ts` cases (written before the implementation) cover STI-target
      decode, MTI-target decode, and variant-narrowed decode — and pass.
- [ ] Validation gate green (below).

## Standing instruction

Stay focused on the goal; control scope. Tests-first, in their own commit. Anything that pulls you
off-goal — touching the SQL builder, the `.variant()` type surface, or integration fixtures — halts
and surfaces to the orchestrator.

## References

- Slice spec: `projects/tml-2683/spec.md` — chosen design (decode half).
- Slice plan: `projects/tml-2683/plan.md` § Dispatch 2.
- D1 commits (already on this branch): `git log --oneline 21551b8f3..HEAD` — the SQL side you build on. Read them to see exactly what cells the child rows now carry.
- `collection-runtime.ts` — `mapPolymorphicRow`, `mapStorageRowToModelFields`, `getMergedColumnToFieldMap`.
- `collection-contract.ts` — `resolvePolymorphismInfo`.
- Parent-side precedent: the `mapPolymorphicRow` call sites in `collection-dispatch.ts` (parent rows).
- Implementer persona: `skills-contrib/drive-dispatch/agents/implementer.md`.

## Operational metadata

- **Model tier:** orchestrator-grade (opus) — correctness-sensitive decode wiring; per-row vs per-include resolution matters.
- **Validation gate (run once, at end):**
  - `pnpm --filter @prisma-next/sql-orm-client typecheck`
  - `pnpm --filter @prisma-next/sql-orm-client test`
  - `pnpm lint:deps`
- **Halt conditions:** the SQL builder must change to make a decode test pass (means D1 left a gap — surface it); an assumption is observed false (e.g. the discriminator column isn't actually present in child rows after D1); diff exceeds ~8 files.
- **Heartbeats:** `wip/heartbeats/implementer.txt` per persona cadence. **Commit hygiene:** explicit staging; tests-first; never push.
