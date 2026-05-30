# Slice plan — review follow-ups (TML-2733)

One PR. The findings interlock (renames ripple across topology + both renderers +
tests; the layout move touches the same module that F01/N2/F05/F06 edit), so this is
one coherent refactor executed in three sequenced phases by a single executor sharing
context. Test-first throughout. Each phase ends green (build + typecheck + lint:deps +
biome + affected suites) before the next begins.

## Phase 1 — Topology layer (migration-tools, pure) — size M

1. **N3** `EdgeKind` → `MigrationEdgeKind` across `migration-list-graph-topology.ts`,
   its `exports/` wrapper, and every CLI consumer (`migration-list-render.ts`,
   `migration-list-data-column.ts`, `migration-list-graph-render.ts`).
2. **N1** `MigrationGraphTopology` → `MigrationListGraphTopology` (type +
   producer-return + all consumers + tests).
3. **F02** per-component lexical DFS seeding. Test first: rooted component + disjoint
   2-node cycle, assert the back-edge is the lexically-seeded one.
4. **C** correct `spec.md` / `design-notes.md` / `plan.md` reuse claims.
- Green gate: `@prisma-next/migration-tools` suite + typecheck.

## Phase 2 — Move layout to CLI + layout-module fixes — size M

1. **A** Move `migration-list-graph-layout.ts` + `test/migration-list-graph-layout.test.ts`
   into the CLI (`src/utils/formatters/` + `test/utils/formatters/`). Delete the
   `exports/migration-list-graph-layout.ts` wrapper, the `package.json` subpath
   export, and the `tsdown.config.ts` entry. Repoint `migration-list-graph-render.ts`
   to the local import. The moved module imports topology types from
   `@prisma-next/migration-tools/migration-list-graph-topology`.
2. **N2** `ConnectorKind` `joinBelow` → `joinAbove` (moved module + renderer + tests).
3. **F01** rule-5 unwoven degrade. Test first: a forward edge whose producer sorts
   lexically above its consumer routes through `placeUnwoven` (`woven: false`); assert
   geometry. Render fixture for the same.
4. **F05** right-trim rendered graph lines; re-baseline affected goldens.
5. **F06** `assignProducerLane` collapse + inline `canonicalTo`.
- Green gate: `@prisma-next/cli` migration-list suites + `lint:deps` (import direction).

## Phase 3 — Glyph-mode relocation + kind-glyph unification (CLI) — size M

1. **B** Move `GlyphMode` / `GlyphModeInput` / `detectGlyphMode` to `terminal-ui.ts`
   (or `glyph-mode.ts` owned by it); renderer imports the capability.
2. **D** Single Unicode kind-glyph table; both renderers consume it.
3. **E** Thread glyph mode into the flat renderer (`renderMigrationListWithStyle`
   gains a `GlyphMode`); `--ascii` governs the flat list. Test first: flat list in
   ASCII mode uses ASCII kind glyphs.
4. **F04** kind glyph bright in both views, routed uniformly through the styler; one-
   line comment at the policy site.
5. **F06** explicit `MigrationListEntry[]` for the `migrationEntries` accumulator.
6. (If clean) command computes topology once and passes `kindByMigrationHash` into the
   renderer.
- Green gate: full migration + cli suites, build, typecheck, lint:deps, biome.

## Review

After phase 3 green: one principal-engineer + architect review pass (Opus 4.8) against
this spec and the PR-628 finding tables; iterate on any must-fix; then open the PR
(TML-2733 prefix) and babysit.
