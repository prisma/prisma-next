# Issue Triage

Issues discovered during project work, captured for later investigation and potential Linear ticket creation.

## Backward edge horizontal segment misaligned with source node

**Discovered:** 2026-03-25 | **Severity:** low

**Observed:** In graphs with backward (rollback) edges, the backward edge exits from the forward arrowhead row above the source node rather than from the source node itself. This makes the rollback appear to originate from the incoming `▾` arrowhead instead of from the node.

Example from the `skipRollback` test graph (graph: `∅→A→B→C→D`, backward edges `C→A` and `C→B`):

```
                    ○ ∅
                    │
                    │ init
                    │
  rollback_to_a     ▾
┌──────────────────▸○ A───────┐
│                             │
│                             │ step_1
│                             │
│                             ▾
│                   ┌────────▸○ B───────┐
│                   │                   │
│                   │                   │ step_2
│                   │ rollback_to_b     │
└───────────────────┼───────────────────▾   ← C→A exits here, from the ▾ above C...
                    │                   ○ C  ← ...instead of from node C itself
                    │                   │
                    │                   │
                    │             step_3│
                    └─────────▾─────────┘
                              ○ D
```

**Root cause:** Dagre offsets backward-edge start control points by one rank from the source node to avoid overlapping with forward edges. With `ranksep: 4`, that offset is just one row, so the backward edge exits from the forward arrowhead's row rather than the node's row.

**Snapshot:** `graph-render.test.ts.snap` → "renders Skip rollback"

**Possible fixes (trade-offs):**
1. Increase `ranksep` — more vertical space separates the two elements, but makes all graphs taller.
2. Post-dagre nudge — after layout, snap backward-edge first control point back to `src.y`. Risk: overlaps with forward edges in the same column.
3. Insert gap row — when a backward edge departs the same column as a forward arrowhead, add a blank row between them. Adds complexity.

---

## Rework "spine" as internal terminology

**Discovered:** 2026-03-25 | **Severity:** low | **Type:** naming/API

**Observed:** "Spine" is graph jargon used throughout the renderer internals: `findSpinePath`, `findSpineEdges`, `spineTarget`, `spineEdgeKeys`, `spineNodeIds`, `truncatedSpine`, `spineTargetHash`, and the `GraphRenderOptions.spineTarget` type field. The spec says user-facing output should use "migration path" or similar, and no user-facing output currently leaks "spine", but the internal API uses it ~60 times across `graph-render.ts`, `graph-types.ts`, and `graph-migration-mapper.ts`.

**Impact:** Makes the code harder to reason about for contributors unfamiliar with the term. Risk of the jargon leaking into future user-facing output or error messages.

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

## `deriveEdgeStatuses` uses graph path instead of ledger for applied status

**Discovered:** 2026-03-26 | **Severity:** high | **Type:** bug — incorrect status display

**Observed:** After running `db update` (which pushes the contract to the DB and writes the marker, but does not write ledger entries), `migration status` shows all edges from root to the marker as `✓ applied` even though no migrations were actually executed.

**Root cause:** `deriveEdgeStatuses` computes applied edges via `findPath(root → markerHash)` — a structural graph query. It assumes every edge on the path to the marker was applied via `migration apply`. The marker only says "the DB schema is at this hash"; the *ledger* records which migrations were actually run. After `db update`, the marker moves but the ledger is empty (or unchanged), so the assumption is wrong.

**Core issue:** There is no `readLedger()` API on `ControlClient`. The CLI can read the marker (`readMarker()`) but has no way to read the list of actually-applied migrations from the ledger table.

**Required fix:**
1. Add `readLedger()` (or equivalent) to `ControlClient` — returns the list of migration IDs recorded in the ledger table.
2. Pass ledger entries into `deriveEdgeStatuses` and mark only those edges as `applied`.
3. Edges on the path to the marker that are not in the ledger need distinct treatment (possibly no status, or a new status indicating the DB is at this state but not via `migration apply`).

**Scope:** Control plane + CLI. Not a graph renderer issue.

**Affected code:**
- `cli/src/commands/migration-status.ts` — `deriveEdgeStatuses`
- `cli/src/control-api/client.ts` — needs `readLedger()` method
- `cli/src/control-api/types.ts` — `ControlClient` interface
- Underlying family/target control plane — needs to expose ledger reads

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

## `migration status --ref` places detached contract node on wrong branch

**Discovered:** 2026-03-25 | **Severity:** medium | **Type:** rendering limitation + diagnostic gap

**Observed:** When `migration status --ref staging` is used and the contract is reachable from a different branch (e.g. prod) but not from staging, the detached `◇ contract` node renders below the bottom-most node in the graph (prod's leaf). The user expects it below the staging node, since that's the branch they're looking at — the visual implies the contract is "after prod" rather than "not yet planned from staging."

With `--graph`, this is worse: the contract node sits below prod's branch while staging's branch has no visual indication that a migration to the contract is missing.

**Root cause:** The detached node placement always aligns with the bottom-most rendered node's X-coordinate. There is no mechanism to anchor a detached node to a specific branch. Anchoring to a mid-graph node would require:
- A phantom edge from the target branch to the detached node so Dagre positions it correctly
- Collision avoidance with other branches that extend below the anchor point
- Updated dashed-line connector logic to handle horizontal offsets

**Related diagnostic gap:** When the contract is in the graph but not reachable from `targetHash` (the active ref), no `CONTRACT.AHEAD` diagnostic fires — that diagnostic only checks `!graph.nodes.has(contractHash)`. The user gets no indication that their chosen ref can't reach the contract. This should fire a diagnostic like "Contract is not reachable from ref — run `migration plan --from <ref>` to plan a migration."

**Scope:** Graph renderer (`graph-render.ts` detached node placement) + CLI diagnostics (`migration-status.ts` CONTRACT.AHEAD condition).

---
