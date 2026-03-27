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

**Linear:** [TML-2097](https://linear.app/prisma-next/issue/TML-2097) — audit all CLI output and error messages for graph jargon.

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

**Observed:** After running `db update` (which pushes the contract to the DB and writes the marker, but does not write ledger entries for individual migrations), `migration status` shows all edges from root to the marker as `✓ applied` even though no migrations were actually executed.

**Root cause:** `deriveEdgeStatuses` computes applied edges via `findPath(root → markerHash)` — a structural graph query. It assumes every edge on the path to the marker was applied via `migration apply`. The marker only says "the DB schema is at this hash"; the *ledger* records which migrations were actually run. After `db update`, the marker moves but the ledger has no per-migration entries, so the assumption is wrong.

**Core issue:** There is no `readLedger()` API on `ControlClient`. The CLI can read the marker (`readMarker()`) but has no way to read the list of actually-applied migrations from the ledger table.

**Ledger schema gap:** The current `prisma_contract.ledger` table stores `origin_core_hash` and `destination_core_hash` (the from/to contract hashes) but does **not** store `dir_name` or `migration_id`. While hash-pair matching against graph edges could work in the common case, it's fragile — the ledger is a DB-side artifact and the on-disk migrations are a repo-side artifact. They can get out of sync (e.g. using one local DB from a different project). The ledger should be self-describing: each entry should identify which migration was applied by name and content-addressed ID, independent of what's on disk.

**Required fix:**

1. **Add `dir_name text` and `migration_id text` columns to the ledger table.** This makes the ledger a proper audit log ("migration `20260315_add_users` (id `abc123`) was applied at this time"). Requires a schema migration of the control tables.
2. **Thread `dirName`/`migrationId` through the runner.** `migration apply` has both values on `MigrationApplyStep`, but they're lost when building the plan for `runner.execute()`. They need to flow through `SqlMigrationRunnerExecuteOptions` → `buildLedgerInsertStatement` → the INSERT. This crosses the family/target boundary.
3. **Add `readLedger()` to the control plane stack:**
   - Core: add to `ControlFamilyInstance` interface in `@prisma-next/core-control-plane/types`
   - Family: add read function in `@prisma-next/family-sql` (analogous to `readMarker()`)
   - CLI: add to `ControlClient` interface and implement in `ControlClientImpl`
4. **Update `deriveEdgeStatuses`:** Accept ledger entries, mark only edges present in the ledger as `applied`. Edges on the path to the marker but not in the ledger could get a new status like `"inferred"` indicating the DB reached that state via `db update`, not `migration apply`.

**Scope:** Ledger schema + Postgres target + SQL family + core control plane + CLI.

**Affected code:**
- `packages/3-targets/3-targets/postgres/src/core/migrations/statement-builders.ts` — ledger table DDL, insert statement
- `packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts` — `recordLedgerEntry()`, execute options
- `packages/2-sql/3-tooling/family/src/core/` — new `readLedger()` function
- `packages/1-framework/1-core/migration/control-plane/src/types.ts` — `ControlFamilyInstance` interface
- `cli/src/control-api/types.ts` — `ControlClient` interface
- `cli/src/control-api/client.ts` — `readLedger()` implementation
- `cli/src/commands/migration-status.ts` — `deriveEdgeStatuses`

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

## `lastEdge` fallback in `migrationGraphToRenderInput` relies on Map insertion order

**Discovered:** 2026-03-25 | **Severity:** low | **Type:** code quality

**Observed:** When `relevantPaths` is empty and `spineTargetHash` can't be derived from `activeRefHash` or `contractHash`, the mapper falls back to `[...graph.forwardChain.values()].flat().pop()`. This relies on `Map` insertion order to pick the "last" edge, which is deterministic but not explicitly topological.

**When it fires:** The only realistic scenario is: migrations exist on disk, contract is unreadable (`CONTRACT.UNREADABLE`), no `--ref`, and the graph is diverged. In this case the result has `diverged: true`, so `relevantPaths` is ignored (full graph is rendered) and `spineTargetHash` only affects edge coloring — making the impact minimal.

**Resolution:** Rather than hardening this fallback, the root cause is that `migration status` should treat an unreadable contract as a hard error (or early return without `graph`) when migrations exist. If the user has migrations on disk but we can't read their contract, we can't give meaningful status — they need to fix the contract first. Making `CONTRACT.UNREADABLE` a hard error eliminates this fallback's only trigger.

---

## `MigrationStatusResult` conflates internal and public shapes

**Discovered:** 2026-03-25 | **Severity:** medium | **Type:** code quality / API hygiene

**Observed:** `MigrationStatusResult` is used both as the return type of `executeMigrationStatusCommand` (consumed by the CLI formatter) and as the `--json` output shape (consumed by users/agents). Internal fields (`graph`, `bundles`, `activeRefHash`, `activeRefName`, `diverged`) are needed by the formatter but should not be in the JSON output. The `--json` handler manually destructures and discards them.

**Problem:** This is an opt-out model — new internal fields leak into JSON output unless someone remembers to strip them. The compiler provides no safety here.

**Suggested fix:** Separate the types. The command should return an internal result type, and a dedicated function or explicit construction should produce the public JSON shape. The public shape is defined once and built explicitly, not derived by stripping fields from a larger type.

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
