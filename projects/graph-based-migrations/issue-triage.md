# Issue Triage

Issues discovered during project work, captured for later investigation and potential Linear ticket creation.

---

## Converging 3-to-1 merge drops a branch entirely

**Discovered:** 2026-03-25 | **Severity:** high

**Observed:** When 3 branches from the same node all merge into a single target (A->B->E, A->C->E, A->D->E), only 2 branches render. Branch C is completely missing from the terminal output — the graph shows A forking to B and D, with D merging back to E, but C is lost.

**Location:**
- `packages/1-framework/3-tooling/cli/src/utils/formatters/graph-layout.ts` (`buildBranchTree`, `assignColumns`)
- Scratchpad test case: `convergingBranches` in `packages/1-framework/3-tooling/cli/scratchpad.ts`

**Impact:** Data loss in the visualization — users won't see an entire migration path. Critical for correctness.

**Suggested fix:** `buildBranchTree` likely treats C's merge into E as a duplicate of D's merge and skips it. The branch tree builder needs to handle multiple independent branches merging into the same target node.

---

## Step-by-step rollback edges collapsed into one visual

**Discovered:** 2026-03-25 | **Severity:** high

**Observed:** Three separate rollback edges (D->C, C->B, B->A) render as a single vertical bar with one `╮`/`╯` pair, making it look like a single rollback from D to A. The individual step-by-step semantics are lost.

**Location:**
- `packages/1-framework/3-tooling/cli/src/utils/formatters/graph-layout.ts` (`computeLayout`, spine backward edge column assignment)
- `packages/1-framework/3-tooling/cli/src/utils/formatters/graph-render.ts` (`backwardRoleAt`, `buildBackwardRuns`)
- Scratchpad test cases: `stepRollback`, `rollbackThenContinue`

**Impact:** Misleading — users can't distinguish "rolled back 3 steps individually" from "rolled back all at once". The rollback history is visually compressed.

**Suggested fix:** Each backward edge needs its own horizontal connectors at its source and target rows. Currently non-overlapping edges share a column, which is correct, but the renderer draws them as one continuous run instead of separate `╮`/`╯` pairs per edge.

---

## Backward edge connector drawn on wrong row

**Discovered:** 2026-03-25 | **Severity:** high

**Observed:** In the "Rollback with intermediate nodes" case (branch A->X->Y with Y->A backward), the `╯` connector appears on C's row (the last spine node) instead of Y's row (the actual source of the backward edge). C has no involvement in the rollback.

**Location:**
- `packages/1-framework/3-tooling/cli/src/utils/formatters/graph-render.ts` (`buildBackwardSpans`, `backwardRoleAt`)
- `packages/1-framework/3-tooling/cli/src/utils/formatters/graph-layout.ts` (`placeBranches` — backward edge placement)
- Scratchpad test case: `rollbackWithNodes`

**Impact:** Incorrect visualization — the backward edge appears to originate from a node that has nothing to do with the rollback.

**Suggested fix:** The backward edge from Y->A is on a branch, not the spine. The backward run's `fromDepth`/`toDepth` need to correspond to Y's and A's depths respectively, and the horizontal connector must be drawn at Y's row, not at the deepest spine node sharing that depth.

---

## Stray pipe characters below graph terminus

**Discovered:** 2026-03-25 | **Severity:** medium

**Observed:** In "Sub-branches" and "Diamond with sub-branch" cases, `│` characters appear on the spine column on edge-line rows below where the spine has ended (e.g., below node C at the graph's maximum spine depth).

**Location:**
- `packages/1-framework/3-tooling/cli/src/utils/formatters/graph-render.ts` (`updateActivePipes`, `buildEdgeRowCells`)
- Scratchpad test cases: `subBranches`, `diamondWithSubBranch`

**Impact:** Visual noise — stray pipes suggest the spine continues when it doesn't.

**Suggested fix:** `updateActivePipes` should not mark the spine column as active if the spine has no forward edge crossing that depth.

---

## Merge connector uses wrong box-drawing character

**Discovered:** 2026-03-25 | **Severity:** low

**Observed:** In the "Complex" diamond case, the merge from C into D's row uses `├──` (T-junction, implying the branch continues downward) instead of `└──` (corner, indicating the branch terminates at the merge). The `columnContinuesAfter` check appears to give a false positive.

**Location:**
- `packages/1-framework/3-tooling/cli/src/utils/formatters/graph-render.ts` (`buildNodeRowCells`, around line 312, `columnContinuesAfter`)
- Scratchpad test case: `complex`

**Impact:** Minor cosmetic — the connector character implies the branch continues when it doesn't.

**Suggested fix:** `columnContinuesAfter` may be picking up the E branch (which forks from D on the same column later). Need to check whether the continuation is from the merge source's column specifically.

---

## Branch edge labels not rendered

**Discovered:** 2026-03-25 | **Severity:** low

**Observed:** Only spine edges display their labels on edge-line rows (e.g., `20260101_init`). Branch edges have labels (e.g., `20260104_feature_x`) but these never appear in the output.

**Location:**
- `packages/1-framework/3-tooling/cli/src/utils/formatters/graph-render.ts` (`buildEdgeRowCells`, lines 347-371)

**Impact:** Feature gap — branch migration names are invisible, reducing the utility of the graph for understanding non-spine migration history.

**Suggested fix:** `buildEdgeRowCells` only checks for `spineEdge?.edge.label`. Add logic to find the forward edge for each branch column at the current depth and render its label.

---

## Backward/rollback edge labels not rendered

**Discovered:** 2026-03-25 | **Severity:** low

**Observed:** Rollback edges carry labels (e.g., `20260104_rollback`) but no mechanism renders them. They could appear next to the `╮` or `╯` connectors.

**Location:**
- `packages/1-framework/3-tooling/cli/src/utils/formatters/graph-render.ts` (`buildNodeRowCells`, backward role handling)

**Impact:** Feature gap — rollback migration names are invisible.

**Suggested fix:** Render the label adjacent to the `╯` (source) connector, similar to how spine labels appear on edge-line rows.

---

## [dagre] Backward edge horizontal segment misaligned with source node

**Discovered:** 2026-03-25 | **Severity:** low | **Renderer:** dagre

**Observed:** In graphs with backward (rollback) edges, the horizontal segment of the backward edge renders one row above the source node instead of on the same row. For example in `skipRollback`, the `C→A` rollback's horizontal `└──...──` runs at row 16 while node C sits at row 17. This creates a visual illusion where the backward edge's horizontal segment appears to connect to the forward edge's `▾` arrowhead (which also occupies row 16) rather than to node C itself.

**Root cause:** Dagre deliberately offsets backward-edge start control points by one rank from the source node to avoid overlapping with forward edges leaving the same node. With our tight `ranksep: 4`, "one rank offset" is only one row, so the backward edge's horizontal segment lands directly on the forward arrowhead's row. The variant builder faithfully follows dagre's routing.

**Repro:** `pnpm tsx -e "import { skipRollback } from './scratchpad-graphs'; import { dagreRenderer } from './src/utils/formatters/graph-render-dagre'; console.log(dagreRenderer.renderFullGraph(skipRollback.nodes, skipRollback.edges, skipRollback.options));"` from `packages/1-framework/3-tooling/cli/`.

**Possible fixes (trade-offs):**
1. Increase `ranksep` — more vertical space separates the two elements, but makes all graphs taller.
2. Post-dagre nudge — after layout, snap backward-edge first control point back to `src.y`. Risk: overlaps with forward edges in the same column.
3. Insert gap row — when a backward edge departs the same column as a forward arrowhead, add a blank row between them. Adds complexity.

---

## Target resolution fails on divergent graphs (offline, no ref)

**Discovered:** 2026-03-25 | **Severity:** high | **Type:** design gap

**Observed:** `migration status` calls `findLeaf(graph)` to determine its spine target when no `--ref` is active. `findLeaf` throws `MIGRATION.AMBIGUOUS_LEAF` on divergent graphs (multiple leaves), causing a hard error. This is wrong — `status` should gracefully display divergent graphs, not crash.

**Root cause:** There is no principled default target when the graph is divergent and no ref is set. `migration apply` avoids this by using the contract hash, but `status` uses `findLeaf` instead. The deeper issue is the absence of an implicit default ref that both commands could agree on.

**Design document:** `projects/graph-based-migrations/specs/target-resolution-design.md`

**Short-term fix:** Replace `findLeaf` with `findReachableLeaves` + contract-hash-in-graph check. When ambiguous, fall back to `--graph` view with a `MIGRATION.DIVERGED` diagnostic guiding the user to use `--ref`.

**Long-term fix:** Implicit default ref (e.g. `local`) set by `migration plan`. Needs PM input — product decision about the mental model.

---

## Rework "spine" as internal terminology

**Discovered:** 2026-03-25 | **Severity:** low | **Type:** naming/API

**Observed:** "Spine" is graph jargon that leaks into function names (`renderSpineGraph`, `extractSubgraph(..., spine)`, `findSpinePath`, `spineTarget`, `spinePath`, `spineEdgeKeys`, etc.) and type fields (`GraphRenderOptions.spineTarget`). The spec already says user-facing output should use "migration path" or similar, but the internal API still uses "spine" everywhere.

**Impact:** Makes the code harder to reason about for contributors unfamiliar with the term. Also increases the risk of the jargon leaking into user-facing output or error messages.

**Suggested fix:** Find a better term for the concept ("apply path"? "target path"? "main path"?) and rename consistently across internal APIs. This is a naming pass, not a behavior change.

---

## Phantom `@prisma-next/cli` dependency in 4 packages causes turbo cache cascade

**Discovered:** 2026-03-25 | **Severity:** high | **Type:** build performance / architecture violation

**Observed:** Four packages declare `@prisma-next/cli` as a production `dependency` in `package.json` but never import from it anywhere (not in `src/`, not in `test/`). Because turbo's `^build` traverses all declared workspace dependencies regardless of whether they're used, any change to a CLI source file forces 9+ unnecessary rebuilds across the dependency graph.

**Location:**
- `packages/3-targets/6-adapters/postgres/package.json` — `dependencies["@prisma-next/cli"]`
- `packages/2-sql/3-tooling/family/package.json` — `dependencies["@prisma-next/cli"]`
- `packages/3-targets/3-targets/postgres/package.json` — `dependencies["@prisma-next/cli"]`
- `packages/3-extensions/pgvector/package.json` — `dependencies["@prisma-next/cli"]`

**Impact:** A one-line change in any CLI source file (e.g., `graph-migration-mapper.ts`) triggers cache misses in `adapter-postgres`, `family-sql`, `target-postgres`, `extension-pgvector`, plus their downstream dependents (`studio`, `postgres`, `prisma-orm-demo`, etc.) — 9+ extra rebuilds for packages whose build output is completely unaffected.

These are also architecture violations: adapters/targets/extensions should not depend on framework tooling. The current `lint:deps` (dependency-cruiser) doesn't catch this because it only validates source-level imports, not `package.json` declarations.

**Suggested fix:** Remove `@prisma-next/cli` from `dependencies` in all four packages. The only legitimate CLI consumer among non-tooling packages is `vite-plugin-contract-emit` (which actually imports `cli/control-api`).

---

## `lint:deps` does not validate `package.json` dependency declarations against architecture rules

**Discovered:** 2026-03-25 | **Severity:** medium | **Type:** tooling gap

**Observed:** The import linter (`pnpm lint:deps` / dependency-cruiser) validates source-level `import` statements against the layer/domain/plane rules in `architecture.config.json`, but it has no awareness of `package.json` `dependencies`, `devDependencies`, or `peerDependencies` declarations. A package can declare a workspace dependency that violates layering rules, and as long as no source file imports from it, the linter passes clean.

This allows phantom dependencies to accumulate (see: "Phantom `@prisma-next/cli` dependency" issue above), creating turbo cache cascades and obscuring the true dependency graph.

**Location:**
- `dependency-cruiser.config.mjs` — current linter config (source-level only)
- `architecture.config.json` — rules that should also apply to `package.json` declarations
- `scripts/lint-deps-focused.mjs` — lint-staged integration (source-level only)

**Impact:** Architecture violations in `package.json` go undetected until they cause build performance problems or someone manually audits the dependency graph. The turbo build cache is the first casualty — phantom deps widen the rebuild blast radius.

**Suggested fix:** Add a companion script (~100-150 lines) that reads each package's `package.json`, resolves workspace deps to their module group via `architecture.config.json`, and applies the same upward/cross-domain/plane rules. Wire it into `pnpm lint:deps` alongside the existing depcruiser call. No new dependencies needed — just `fs`, `path`, and JSON reading.

---
