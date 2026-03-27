# Summary

Redesign `migration status` to answer two questions: (1) "can I apply, and what would happen?" and (2) "if not, what do I need to do?" The default view shows the minimum context needed to act: the apply path with edge statuses, plus any relevant forks (DB marker on a different branch, ref divergence) that explain why action is needed. An optional `--graph` flag shows the full migration graph for orientation.

# Description

`migration status` currently shows only a single linear path through the migration graph — no branches, no forks, no visibility into the graph's actual shape. When the graph has multiple leaves (divergent branches — common during team collaboration), the command fails entirely (`AMBIGUOUS_LEAF`) before producing any output.

## Why the default view isn't a simple linear list

A single linear path is only correct when the user's state is trivially simple: one branch, DB marker on it, contract at the tip. In practice, collaborative workflows produce states where a linear list is either misleading or impossible:

- **DB marker on a different branch.** Two developers branch from the same point. Dev A applies their migration (marker moves to branch A). Dev B's migration is on branch B, which is the contract target. A linear list from root→contract would show all edges as "pending" — but the user can't just apply, because the DB is on a different branch. Without seeing the fork, the user has no idea why `migration apply` would fail.

- **Diamond convergence.** Both developers eventually plan migrations from their respective branches to the agreed-upon final contract. The graph is a diamond. A linear list can only show one path — the user doesn't see that there's a second path from the other branch, which is critical context for understanding the migration topology.

- **Ref divergence.** The user runs `migration status --ref staging` while their DB is on a different branch. A linear list to the ref hides the relationship between the DB state and the ref — the user needs to see both to understand what `migration apply --ref staging` would do.

- **Contract ahead of all migrations.** The contract has changed but no migration has been planned. A linear list of existing migrations gives no indication that action is needed — the user needs to see the gap between the last migration and the contract. TODO: They also need to decide where to migrate from, right?

In all these cases, the user needs to see the *structure* — the fork, the convergence, the gap — not just a flat list of migrations. The default view includes exactly the branches needed to explain the current state, and nothing more. It's the minimum context to act, not the minimum number of lines.

In the common case — one branch, DB on it, contract at the tip — the default view *is* a simple linear list. The graph structure only becomes visible when it's needed to explain why the state isn't straightforward.

## The redesign

1. **Default view (relevant subgraph):** Align the target with `migration apply` semantics — contract hash (or ref hash if `--ref`). Extract the union of all relevant paths (root→contract, root→DB marker, root→ref) via `extractRelevantSubgraph`. When all targets align (the common case), this is a linear chain. When they diverge (e.g. DB marker on a different branch), the fork is naturally visible. For long graphs, truncate to the last ~N edges (default N=10) and show a `┊` indicator for elided history.

2. **Full graph view (`--graph`):** Render the entire `MigrationGraph` as a topologically-ordered ASCII graph using Dagre for layout. Branches, diamonds, and rollback cycles are all visible. Divergent graphs render successfully instead of erroring. Truncation applies here too.

Both views share the same renderer — the only difference is what graph is passed in. The renderer is agnostic to this distinction.

**Affected code:**
- `cli/src/commands/migration-status.ts` — command logic, target resolution, edge status derivation via `deriveEdgeStatuses`
- `cli/src/utils/formatters/graph-render.ts` — Dagre-based graph renderer (includes `GraphRenderer` interface)
- `cli/src/utils/formatters/graph-migration-mapper.ts` — migration-to-graph mapper (relevant paths, markers, status icons)
- `cli/src/utils/formatters/graph-types.ts` — `RenderGraph`, `GraphNode`, `GraphEdge`, `GraphRenderOptions`
- `migration-tools/src/dag.ts` — `findPath`, `findPathWithDecision`
- `cli/src/utils/formatters/migrations.ts` — `formatMigrationStatusOutput` removed; `resolveDisplayChain` and `buildMigrationEntries` are now private to `migration-status.ts`

**Ticket:** [TML-2100](https://linear.app/prisma-company/issue/TML-2100)

# Graph Model

## Terminology

- **Node**: A contract hash representing a database state.
- **Edge**: A migration (from→to) transforming one state to another. Carries: `dirName`, `migrationId`, `createdAt`.
- **Spine**: The path from `∅` to the apply target (contract hash, or ref hash if `--ref`). Used internally for layout coloring and truncation — not exposed to users.
- **Forward branch**: An edge sequence that forks from the spine and ends at its own leaf (divergent, never reconnects).
- **Cycle branch**: An edge sequence that forks from the spine and eventually reconnects to a spine node (rollback).
- **Backward edge**: An edge within a cycle that points to a node earlier in topological order (e.g., `C→A` in a rollback `A→X→Y→C→A`).
- **Diamond**: A branch that forks from and merges back to the spine (common in team collaboration).

## User-Facing Language

Internal graph terminology must not leak into CLI output. The mapping:

| Internal term | User-facing term |
|---|---|
| Node | (not shown — nodes are contract hashes, displayed as short hashes) |
| Edge | Migration |
| Spine | "migration path" or just the rendered chain — no label needed |
| Forward branch | "branch" (in `--graph` output) |
| Backward edge | "rollback" |
| Diamond | (no user-facing term — it's just how branches look when they merge) |
| Spine target | "target" |
| DB marker | `◆ db` |
| Contract marker | `◆ contract` (planned) or `◇ contract` (unplanned) |
| Ref marker | ref name inline on node row |
| Detached contract | `◇ contract` with dashed connector |

User-facing messages use migration-domain language:
- "3 pending migration(s) — run 'prisma-next migration apply' to apply"
- "Database is up to date"
- "No migration exists for the current contract"
- "No path between database marker and ref"
- "There are multiple valid migration paths — you must select a target"
- Not: "spine target is at node X" or "3 edges on the spine"

## Edge Status Semantics

Edge status is derived by `deriveEdgeStatuses` in the command layer using path analysis across the full graph. The function takes the graph, target hash, contract hash, marker hash, and mode. It computes three kinds of paths and assigns statuses:

- **Applied** (`✓`, cyan): The edge is on the path from `∅` to the DB marker. (Note: this is currently a graph-path heuristic — `deriveEdgeStatuses` uses `findPath`, not the ledger. After `db update`, edges show as applied even though no migrations were executed. See triaged issue: "`deriveEdgeStatuses` uses graph path instead of ledger for applied status.")
- **Pending** (`⧗`, yellow): The edge is on the path from the DB marker (or root, if empty DB) to the target, or from the target to the contract (when the target is a ref and the contract is reachable beyond it). These are migrations `migration apply` would execute.
- **Unreachable** (`✗`, magenta): The edge is on the path from root to the target but is neither applied nor pending. This happens when the DB marker is on a different branch than the target — `apply` can't reach these edges without the DB first moving to this branch.
- **No status** (no icon, dim): Everything else — branch edges not on any relevant path. They exist in the graph but are not on the user's apply path.

Special cases:
- **Empty DB** (no marker, online): All edges from root to the target are pending — the effective marker is the root.
- **Offline mode**: No statuses assigned — no icons shown.
- **Marker not in graph**: DB was managed externally. Diagnostic emitted.

## Two Views

### Default view: relevant subgraph

Renders the minimal subgraph covering all interesting paths. The path computation in `migrationGraphToRenderInput` prioritizes continuity:

1. Path to the DB marker (if online)
2. Path to the ref (if `--ref`)
3. Path(s) to the contract — tries both marker→contract and ref→contract independently (rather than an independent BFS from root, which may route through an unrelated branch). In diamond collaboration graphs, both legs are included so the full convergence is visible.

When all targets align (the common case), this is a linear chain. When they diverge, the fork is naturally visible.

### Full graph view: `--graph`

Renders the entire migration graph with all branches, diamonds, and cycles visible. Uses Dagre for multi-column layout with box-drawing connectors.

## Spine Target Resolution

Resolution order:

1. **`--ref` flag active** → ref hash.
2. **Contract hash is a node in the graph** → contract hash.
3. **Contract hash is not in the graph** (contract ahead) → fall back to `findReachableLeaves`:
   - **Single leaf** → use it as the spine target. A detached contract node renders below with a dashed connector.
   - **Multiple leaves** → no principled default target. Fall back to full-graph view with a diagnostic: "There are multiple valid migration paths — you must select a target."
4. **Contract hash is `∅`** (no contract emitted) → no meaningful target.

**Why not `findLeaf`?** `findLeaf` throws `AMBIGUOUS_LEAF` on divergent graphs. `migration status` should never hard-fail on a valid graph shape — it's a read-only display command.

**Consistency with `migration apply`:** `apply` uses the contract hash and fails if there's no path from the marker to it. `status` uses the same target but handles the "no path" case gracefully (detached node, or full-graph fallback) instead of failing.

## Detached Contract Node

When the current contract hash is not in the graph (no migration planned for it yet), render a detached node below the graph with a dashed connector:

```
○ cd5c15b prod
┊
◇ bdc08a6 ◇ contract
```

The detached node aligns with the bottom-most node in the rendered graph.

## Contract Diagnostic

A `CONTRACT.AHEAD` diagnostic is emitted when the contract hash is not a node in the migration graph — meaning no migration has been planned that produces the current contract state.

- **No migrations at all**: "No migration exists for the current contract" (fires when `attested.length === 0`)
- **Migrations exist but none produce the contract**: "Contract has changed since the last migration was planned"

This does **not** fire when a migration for the contract exists but the target (e.g. a `--ref`) points elsewhere — that's a different branch, not a stale contract.

**Known gap:** When `--ref staging` is used and the contract is in the graph but only reachable from a different branch (e.g. prod), no diagnostic fires. The user sees the contract on prod's branch with no indication that staging can't reach it. The fix requires both a new diagnostic ("contract is not reachable from ref") and a rendering change to anchor the detached contract node to the chosen ref's branch rather than the bottom-most node. See issue triage: "migration status --ref places detached contract node on wrong branch."

## Marker Not In Graph (early bail-out)

When the DB marker exists but its hash is not a node in the migration graph **and** differs from the contract hash, `migration status` bails out early — no graph is rendered, only a diagnostic with actionable hints.

**Why bail out?** The marker being off-graph means the DB was updated outside the migration system (typically via `db update`). In this state, no edge in the graph can be reliably marked as applied (the ledger isn't consulted — see triaged issue), and there is no meaningful "apply path" to show the user. Rendering a full graph with no statuses and misleading diagnostics is worse than a clear error.

**Recovery hints** vary by scenario:
- Contract is in the graph → suggest `db sign` (align marker to contract) or `db verify`
- Contract is also off-graph → suggest `contract infer` (align contract to DB) or `db verify`

**Exception — marker equals contract hash:** When the marker matches the contract but neither is in the graph, the DB and contract are in sync (the user did `db update` with the current contract). In this case, proceed normally — the detached contract node renders with both `◆ db` and `◇ contract` markers, and the diagnostic guides the user to run `migration plan`.

# Renderer Architecture

## Single renderer

The graph renderer lives in `cli/src/utils/formatters/graph-render.ts` and exports:

```typescript
interface GraphRenderer {
  render(graph: RenderGraph, options: GraphRenderOptions): string;
}

const graphRenderer: GraphRenderer;
```

The renderer is agnostic to whether it receives a full graph or a filtered subgraph. The caller controls filtering:

- **Default view**: `extractRelevantSubgraph(graph, relevantPaths)` → `graphRenderer.render(subgraph, options)`
- **`--graph` view**: `graphRenderer.render(fullGraph, options)`

`RenderGraph` is an immutable directed graph with adjacency-list indexing, built once from flat `GraphNode[]` and `GraphEdge[]` arrays.

Helper functions exported from the same file:
- `extractSubgraph(graph, path)` → single-path extraction
- `extractRelevantSubgraph(graph, paths)` → multi-path union
- `truncateGraph(graph, spine, limit)` → truncated graph with marker-aware expansion

The `render` method handles truncation internally (via `findSpinePath` + `truncateGraph` when `options.limit` is set).

## Generic graph interface

```typescript
interface GraphNode {
  readonly id: string;
  readonly markers?: readonly NodeMarker[];
  readonly style?: 'normal' | 'detached';
}

interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly colorHint?: 'applied' | 'pending' | 'unreachable';
}

interface GraphRenderOptions {
  readonly spineTarget: string;
  readonly rootId?: string;
  readonly colorize?: boolean;
  readonly limit?: number;
  readonly dagreOptions?: {
    readonly ranksep?: number;
    readonly nodesep?: number;
    readonly marginx?: number;
    readonly marginy?: number;
  };
}
```

`colorHint` is a domain-agnostic visual hint: the renderer maps `'applied'` → cyan, `'pending'` → yellow, `'unreachable'` → magenta (overriding the default role-based edge coloring). The renderer has no knowledge of migration status — it just colors by hint.

## Migration-specific mapping layer

`migrationGraphToRenderInput` maps `MigrationGraph` + status info onto the generic renderer types. It receives:

- `graph: MigrationGraph` — the full migration graph
- `mode: 'online' | 'offline'` — whether we have DB connectivity
- `markerHash?: string` — DB marker position (from ledger)
- `contractHash: string` — current contract hash
- `edgeStatuses?: EdgeStatus[]` — per-edge applied/pending/unreachable status
- `refs?, activeRefHash?, activeRefName?` — ref context

The mapper:

1. **Computes relevant paths** with continuity-aware routing: tries both marker→contract and ref→contract independently (rather than an independent root→contract BFS, which may route through an unrelated branch). In diamond graphs, both legs are included.
2. **Resolves spine target** (for edge coloring and detached node alignment).
3. **Bakes status icons into edge labels**: `✓` for applied, `⧗` for pending, `✗` for unreachable (from `edgeStatuses`).
4. **Sets `colorHint`** on edges: applied → cyan, pending → yellow, unreachable → magenta.
5. **Attaches markers** to nodes: DB, contract, refs.

The mapper does not derive edge status itself — it receives pre-computed `edgeStatuses` from the command layer's `deriveEdgeStatuses`.

## Dagre-based layout

Layout uses the `@dagrejs/dagre` library (Sugiyama framework):

1. **Layer assignment**: Dagre assigns nodes to layers (rows) respecting edge direction
2. **Ordering**: Minimizes edge crossings within layers
3. **Coordinate assignment**: Positions nodes on a grid
4. **Edge routing**: Routes edges through virtual nodes at each layer, producing bend points

The renderer converts Dagre's coordinate output into a character grid, using box-drawing characters (`│`, `─`, `├`, `┐`, `└`, `┘`, `┬`, `┴`, `┼`) based on directional bitmasks at each cell. The `CharGrid` class handles ANSI-safe rendering via color-run batching.

## Data flow: `migration status` command

```
executeMigrationStatusCommand
  ├── loadMigrationBundles → graph, attested
  ├── buildMigrationEntries → entries (for JSON migrations array)
  ├── deriveEdgeStatuses(graph, targetHash, contractHash, markerHash, mode)
  │     → edgeStatuses: EdgeStatus[]  (applied/pending/unreachable)
  ├── summary + diagnostics (counts from edgeStatuses)
  └── MigrationStatusResult
        ├── graph, migrations, edgeStatuses, markerHash, contractHash, targetHash, ...
        │
        ▼  (CLI handler)
  migrationGraphToRenderInput({
    graph, mode, markerHash, contractHash, edgeStatuses, refs...
  })
        │
        ▼
  MigrationRenderInput
    ├── graph: RenderGraph        (full graph: nodes with markers, edges with labels + colorHint)
    ├── options: GraphRenderOptions
    └── relevantPaths: string[][]  (continuity-aware paths to contract, marker, ref)
         │
         ├─ [default]   extractRelevantSubgraph(graph, relevantPaths) → graphRenderer.render(subgraph, options)
         └─ [--graph]   graphRenderer.render(graph, options)
         │
         ▼
       ASCII string → stdout
       legend → stdout (online mode)
       summary + diagnostics → stdout
```

# Requirements

## Functional Requirements

1. **Default relevant subgraph view**: `migration status` renders the union of relevant paths as a graph. In the common case (all targets aligned) this is a linear chain.

2. **Full graph view**: `migration status --graph` renders all nodes reachable from root (`∅`), including branches, merges (diamonds), and rollback edges.

3. **Dagre-based layout**: Uses Dagre for multi-column layout. Box-drawing characters connect nodes across columns.

4. **Edge-based labels**: Migration metadata (dirName, status icon) appears on edge lines between nodes.

5. **Node-based markers**: Ref labels, DB marker (`◆ db`), and contract marker (`◆ contract`) appear inline on the node row.

6. **Target alignment**: Target matches `migration apply` semantics: `--ref` → ref hash, else → contract hash.

7. **Detached contract node**: When the contract hash has no corresponding migration, show a dashed connector from the bottom-most node to a `◇ contract` node.

8. **Cycle visibility**: Rollback cycles are visible in the full graph view. Backward edges are rendered distinctly (magenta).

9. **No `findLeaf` crash**: Divergent graphs render successfully. The default view targets the contract hash, not a leaf.

10. **Offline mode**: Without DB connection, render the graph with no applied/pending distinction.

11. **JSON output**: `--json` outputs structured result with migration data (internal graph fields stripped).

12. **Deterministic output**: Same graph always produces the same output.

13. **Color output**: ANSI color with `--no-color` override. CVD-safe palette — no red/green (green is not used anywhere). Meaning conveyed by shape/icon, color reinforces.

14. **Truncation**: Both views truncate long graphs by default (N=10). `--limit N` overrides. `--all` disables. Marker-aware expansion: effective length = `max(limit, distance from earliest relevant marker to target)`.

15. **Edge status**: Applied (`✓` cyan), pending (`⧗` yellow), unreachable (`✗` magenta). Derived by `deriveEdgeStatuses` in the command layer. Empty DB treats root as effective marker — all edges to target are pending.

16. **Legend**: Always shows all three statuses (`✓ applied  ⧗ pending  ✗ unreachable`) right after the graph in online mode.

17. **Diagnostics**: Contract-ahead diagnostic fires when the contract hash is not in the graph (no planned migration produces it). Marker-not-in-graph diagnostic fires when DB was managed externally.

## Non-Functional Requirements

1. **Performance**: ≤1000 nodes renders in <100ms.
2. **Terminal width**: Respects terminal width. Default 80 columns when width unavailable.

## Cross-command: `migration plan` needs optional online support

**Discovery context**: While testing `migration status` with the multi-path default view, we found a scenario where `migration plan` produces an unusable migration:

1. User has migrations A→B→C applied (DB marker at C).
2. User changes the contract, runs `migration plan --from B` (creates branch B→D).
3. User changes the contract again, runs `migration plan` (no `--from`).
4. `migration plan` calls `findLatestMigration(graph)` → `findLeaf(graph)`. With two leaves (C and D), `findLeaf` throws `AMBIGUOUS_LEAF`. If there's only one leaf (e.g. D was the only leaf), it picks D as `--from`.
5. The planned migration starts from D, not from C (where the DB is). The resulting migration cannot be applied.

**Required fix**: `migration plan` should support an optional `--db` connection. When online, the default `--from` should be the DB marker hash instead of the graph leaf.

**Alignment principle**: `migration status` shows "what `migration apply` would do." `migration plan` should produce migrations that `migration apply` can actually execute. Both need to agree on the starting point.

## Non-goals

- Graph editing/manipulation — read-only display
- Interactive TUI — no scrolling, selection, or keyboard navigation
- Graphviz/DOT/SVG export — ASCII only
- Branch stubs/indicators on the default view (future extension)
- Rewriting `findLeaf` / `findPath` — these remain for `migration plan` and `migration apply`

# Acceptance Criteria

### Default view
- [x] Linear chain renders correctly with applied/pending status and markers
- [x] Target matches `migration apply` target (contract hash or ref hash)
- [x] Detached contract node renders when contract hash is not in graph
- [x] Offline mode shows graph without status badges
- [x] Divergent graph does not crash — shows full graph with diagnostic
- [x] Long graph (>N edges) truncates with `┊` indicator for elided history
- [x] Relevant path tries both marker→contract and ref→contract independently (not BFS shortest path)

### Full graph view (`--graph`)
- [x] Linear chain renders correctly
- [x] Two forward branches from the same node render in separate columns
- [x] Diamond (branch then merge) renders fork and convergence with connectors
- [x] Rollback cycle renders with forward portion and backward edge visually distinct
- [x] Detached contract node renders with dashed connector from bottom-most node
- [x] Ordering is deterministic: same graph always produces same output
- [x] Long graph truncates to last N nodes from target with subgraph rendering

### Status labeling
- [x] Online mode: applied edges show `✓`, pending edges show `⧗`, unreachable edges show `✗`
- [x] Empty DB (no marker): all edges to target are `⧗` pending
- [x] Offline mode: no status icons on any edge
- [x] Legend always shows all three statuses right after the graph

### Diagnostics
- [x] "No migration exists for the current contract" fires when no migrations exist and contract is non-empty
- [x] "Contract has changed since the last migration was planned" fires when migrations exist but contract hash is not in the graph
- [x] Neither contract diagnostic fires when a migration for the contract exists (even if `--ref` points elsewhere)
- [x] "There are multiple valid migration paths" fires for divergent graph with no default target
- [x] Marker-not-in-graph diagnostic fires when DB marker is not in the migration graph

### Accessibility
- [x] Color palette is CVD-safe (no red/green contrast)
- [x] All meaning is conveyed by shape/icon — color is reinforcement only
- [x] Output is fully understandable with `--no-color`

### Truncation flags
- [x] `--limit N` overrides the default truncation length
- [x] `--all` disables truncation (shows full history)
- [x] Truncation window expands beyond `--limit` when needed to include contract and DB markers

### User-facing language
- [ ] No graph jargon (spine, node, edge, leaf, forward branch) in CLI output, error messages, or diagnostics (deferred — audit in separate PR)
- [ ] JSON field names use migration-domain language (not graph internals) (deferred)

### Tests
- [x] Unit tests for `render`: linear, branching, diamond, rollback topologies
- [x] Unit tests for `extractSubgraph` and `extractRelevantSubgraph`: correct node/edge filtering, multi-path union
- [x] Snapshot tests against expected ASCII output
- [x] `migration-status.test.ts` tests replaced to cover new output format and edge status derivation

# Other Considerations

## Security

No security implications — read-only display change to a local CLI command.

## Cost

No cost implications — no infrastructure changes.

## Observability

No new observability needed. JSON output gains graph topology data for CI consumers.

## Data Protection

No data protection implications — migration metadata only.

## Analytics

No analytics events — CLI command, no telemetry.

# References

- [TML-2100](https://linear.app/prisma-company/issue/TML-2100) — Linear ticket
- `cli/src/commands/migration-status.ts` — command implementation
- `cli/src/commands/migration-apply.ts` — apply target logic (reference for target alignment)
- `cli/src/utils/formatters/graph-types.ts` — `GraphNode`, `GraphEdge`, `RenderGraph`, `GraphRenderOptions`
- `cli/src/utils/formatters/graph-migration-mapper.ts` — `migrationGraphToRenderInput`, `EdgeStatus`
- `cli/src/utils/formatters/graph-render.ts` — `GraphRenderer` interface, `graphRenderer`, `extractRelevantSubgraph`, `truncateGraph`
- `cli/test/utils/formatters/test-graphs.ts` — shared test graph definitions (35+ topologies)
- `cli/test/utils/formatters/graph-render.test.ts` — renderer unit and snapshot tests
- `migration/src/dag.ts` — `reconstructGraph`, `findPath`, `findPathWithDecision`

# Resolved Decisions

1. **Default view is relevant subgraph, not full graph**: The default `migration status` output shows the union of all relevant paths (root→contract, root→DB, root→ref). The full graph is opt-in via `--graph`.

2. **Target aligns with `migration apply`**: Contract hash (or ref hash if `--ref`), not `findLeaf`. Fallback chain when contract is not in the graph: single leaf → use it; multiple leaves → full-graph view with diagnostic. This eliminates the `AMBIGUOUS_LEAF` crash.

3. **Single `render` function, caller controls filtering**: The `GraphRenderer` interface has a single `render(graph, options)` method. The caller decides what graph to pass.

4. **Dagre for layout**: Layout uses `@dagrejs/dagre` (Sugiyama framework).

5. **Single renderer**: The edge-centric and DOT renderers were deleted. The Dagre renderer is the sole renderer in `graph-render.ts`. No `--renderer` flag, no registry.

6. **DB marker on a branch node**: The marker's hash determines which edges are applied. Status derivation uses `deriveEdgeStatuses` which does full-graph path analysis.

7. **Orphaned subgraphs**: Error. All nodes must be reachable from root.

8. **Empty graph**: Show `No migrations found` plus diagnostics.

9. **`--ref` changes target**: `--ref` changes the target (and thus which path is rendered). Different refs produce different views.

10. **Renderer location**: `cli/src/utils/formatters/` — generic renderer with no migration dependencies.

11. **Off-spine markers**: Nodes with markers always render their hash in bold, regardless of spine membership.

12. **Inline markers**: Markers (`◆ db`, `◆ contract`, ref names) stay inline on the node row.

13. **Icons only for status, no words**: Edge status uses `✓` (applied), `⧗` (pending), `✗` (unreachable). Legend at the bottom always shows all three.

14. **CVD-safe color palette**:

| Element | Color | Rationale |
|---|---|---|
| Applied edge/icon (`✓`) | Cyan | Visible to all CVD types |
| Pending edge/icon (`⧗`) | Yellow | High contrast on dark bg, CVD-safe |
| Unreachable edge/icon (`✗`) | Magenta | Distinct from cyan/yellow, CVD-safe |
| Backward/rollback edge | Magenta | Same as unreachable — visually distinct |
| DB/Contract markers | Bold/bright white | Stands out without relying on hue |
| Branch pipes | Dim | Visual structure, not information |

15. **Edge status derivation via `deriveEdgeStatuses`**: A dedicated function in the command layer computes per-edge status using path analysis. It handles: applied (root→marker), pending (marker→target, target→contract), unreachable (root→target minus applied/pending), and empty DB (root as effective marker).

16. **`RenderGraph` as the single graph representation**: Built once at the mapping boundary, passed immutably through the pipeline.

17. **Relevant path computation tries both marker and ref independently**: When computing paths for the default view, the mapper tries both marker→contract and ref→contract independently (rather than root→contract BFS). In diamond collaboration graphs, both legs are included so the full convergence is visible.

18. **`colorHint` for domain-agnostic edge coloring**: The renderer applies `colorHint` in preference to role-based coloring (spine/branch/backward).

19. **Contract diagnostic fires when contract is not in graph**: The `CONTRACT.AHEAD` diagnostic fires when the contract hash is not a node in the migration graph (no planned migration produces it). It does not fire when a migration for the contract exists but the target points elsewhere (e.g. `--ref` on a different branch).

20. **Detached node alignment**: Detached contract nodes align with the bottom-most node in the rendered graph, not the spine target.

21. **Marker not in graph → early bail-out**: When the DB marker is off-graph and differs from the contract, skip graph rendering entirely and show a diagnostic. We can't provide a useful apply path because no edge can be reliably marked as applied. When marker equals contract (both off-graph), proceed normally — the detached node shows both markers and the user is guided to `migration plan`.

# Open Questions

1. **JSON output shape**: Conceptual shape agreed. Exact field names TBD.

2. **Summary line for `--graph` mode**: The default summary ("N pending — run apply") makes sense. What summary is appropriate for `--graph` where multiple branches may have different states?
