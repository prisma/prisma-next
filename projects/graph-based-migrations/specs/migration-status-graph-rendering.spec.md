# Summary

Redesign `migration status` output around the principle "show what `migration apply` would do." The default view renders the relevant subgraph (the union of paths to contract, DB marker, and ref) — in the common case this is a linear chain. An optional `--graph` flag renders the full migration graph with branches, diamonds, and rollback cycles using a Dagre-based ASCII layout.

# Description

`migration status` currently calls `findLeaf(graph)` to pick a single target node, then `findPath(∅ → target)` to produce a linear chain which `formatMigrationStatusOutput` renders as a vertical list. When the graph has multiple leaves (divergent branches — common during team collaboration), `findLeaf` throws `AMBIGUOUS_LEAF` and the command fails before producing any output.

The redesign has two parts:

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

- **Applied** (`✓`, cyan): The edge is on the path from `∅` to the DB marker. These migrations are recorded in the ledger.
- **Pending** (`⧗`, yellow): The edge is on the path from the DB marker (or root, if empty DB) to the target, or from the target to the contract (when the target is a ref and the contract is reachable beyond it). These are migrations `migration apply` would execute.
- **Diverged** (`✗`, magenta): The edge is on the path from root to the target but is neither applied nor pending. This happens when the DB marker is on a different branch than the target — `apply` can't reach these edges without the DB first moving to this branch.
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
3. Path to the contract — preferring to continue from the marker or ref rather than an independent BFS from root (which may route through an unrelated branch)

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

When the contract hash doesn't match the target, a `CONTRACT.AHEAD` diagnostic is emitted:
- **No migration exists for the contract**: "No migration exists for the current contract"
- **Contract has changed since last plan**: "Contract has changed since the last migration was planned"

This fires regardless of whether a ref is active — the user should always know when the contract is ahead.

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
  readonly colorHint?: 'applied' | 'pending' | 'diverged';
}

interface GraphRenderOptions {
  readonly spineTarget: string;
  readonly rootId?: string;
  readonly colorize?: boolean;
  readonly limit?: number;
}
```

`colorHint` is a domain-agnostic visual hint: the renderer maps `'applied'` → cyan, `'pending'` → yellow, `'diverged'` → magenta (overriding the default role-based edge coloring). The renderer has no knowledge of migration status — it just colors by hint.

## Migration-specific mapping layer

`migrationGraphToRenderInput` maps `MigrationGraph` + status info onto the generic renderer types. It receives:

- `graph: MigrationGraph` — the full migration graph
- `mode: 'online' | 'offline'` — whether we have DB connectivity
- `markerHash?: string` — DB marker position (from ledger)
- `contractHash: string` — current contract hash
- `edgeStatuses?: EdgeStatus[]` — per-edge applied/pending/diverged status
- `refs?, activeRefHash?, activeRefName?` — ref context

The mapper:

1. **Computes relevant paths** with continuity-aware routing: prefers marker→contract and ref→contract over independent root→contract (which BFS may route through an unrelated branch).
2. **Resolves spine target** (for edge coloring and detached node alignment).
3. **Bakes status icons into edge labels**: `✓` for applied, `⧗` for pending, `✗` for diverged (from `edgeStatuses`).
4. **Sets `colorHint`** on edges: applied → cyan, pending → yellow, diverged → magenta.
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
MigrationStatusResult (from executeMigrationStatusCommand)
  ├── graph: MigrationGraph
  ├── migrations: MigrationStatusEntry[]  (dirName + status per edge)
  ├── markerHash?: string
  ├── contractHash: string
  ├── targetHash: string
  └── refs, mode, etc.
         │
         ▼
  deriveEdgeStatuses(graph, targetHash, contractHash, markerHash, mode)
    → EdgeStatus[]  (applied/pending/diverged)
         │
         ▼
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

13. **Color output**: ANSI color with `--no-color` override. CVD-safe palette — no red/green contrast. Meaning conveyed by shape/icon, color reinforces.

14. **Truncation**: Both views truncate long graphs by default (N=10). `--limit N` overrides. `--all` disables. Marker-aware expansion: effective length = `max(limit, distance from earliest relevant marker to target)`.

15. **Edge status**: Applied (`✓` cyan), pending (`⧗` yellow), diverged (`✗` magenta). Derived by `deriveEdgeStatuses` in the command layer. Empty DB treats root as effective marker — all edges to target are pending.

16. **Legend**: Always shows all three statuses (`✓ applied  ⧗ pending  ✗ diverged`) right after the graph in online mode.

17. **Diagnostics**: Contract-ahead diagnostic fires when the contract doesn't match the target, regardless of ref. Marker-not-in-graph diagnostic fires when DB was managed externally.

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
- [ ] Linear chain renders correctly with applied/pending status and markers
- [ ] Target matches `migration apply` target (contract hash or ref hash)
- [ ] Detached contract node renders when contract hash is not in graph
- [ ] Offline mode shows graph without status badges
- [ ] Divergent graph does not crash — shows full graph with diagnostic
- [ ] Long graph (>N edges) truncates with `┊` indicator for elided history
- [ ] Relevant path prefers marker→contract and ref→contract continuity over BFS shortest path

### Full graph view (`--graph`)
- [ ] Linear chain renders correctly
- [ ] Two forward branches from the same node render in separate columns
- [ ] Diamond (branch then merge) renders fork and convergence with connectors
- [ ] Rollback cycle renders with forward portion and backward edge visually distinct
- [ ] Detached contract node renders with dashed connector from bottom-most node
- [ ] Ordering is deterministic: same graph always produces same output
- [ ] Long graph truncates to last N nodes from target with subgraph rendering

### Status labeling
- [ ] Online mode: applied edges show `✓`, pending edges show `⧗`, diverged edges show `✗`
- [ ] Empty DB (no marker): all edges to target are `⧗` pending
- [ ] Offline mode: no status icons on any edge
- [ ] Legend always shows all three statuses right after the graph

### Diagnostics
- [ ] "No migration exists for the current contract" fires when contract has no migration
- [ ] "Contract has changed since the last migration was planned" fires when contract moved
- [ ] Both diagnostics fire regardless of whether a ref is active
- [ ] "There are multiple valid migration paths" fires for divergent graph with no default target
- [ ] Marker-not-in-graph diagnostic fires when DB marker is not in the migration graph

### Accessibility
- [ ] Color palette is CVD-safe (no red/green contrast)
- [ ] All meaning is conveyed by shape/icon — color is reinforcement only
- [ ] Output is fully understandable with `--no-color`

### Truncation flags
- [ ] `--limit N` overrides the default truncation length
- [ ] `--all` disables truncation (shows full history)
- [ ] Truncation window expands beyond `--limit` when needed to include contract and DB markers

### User-facing language
- [ ] No graph jargon (spine, node, edge, leaf, forward branch) in CLI output, error messages, or diagnostics
- [ ] JSON field names use migration-domain language (not graph internals)

### Tests
- [ ] Unit tests for `render`: linear, branching, diamond, rollback topologies
- [ ] Unit tests for `extractSubgraph` and `extractRelevantSubgraph`: correct node/edge filtering, multi-path union
- [ ] Snapshot tests against expected ASCII output
- [ ] Existing `migration-status.test.ts` tests updated to match new format

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

13. **Icons only for status, no words**: Edge status uses `✓` (applied), `⧗` (pending), `✗` (diverged). Legend at the bottom always shows all three.

14. **CVD-safe color palette**:

| Element | Color | Rationale |
|---|---|---|
| Applied edge/icon (`✓`) | Cyan | Visible to all CVD types |
| Pending edge/icon (`⧗`) | Yellow | High contrast on dark bg, CVD-safe |
| Diverged edge/icon (`✗`) | Magenta | Distinct from cyan/yellow, CVD-safe |
| Backward/rollback edge | Magenta | Same as diverged — visually distinct |
| DB/Contract markers | Bold/bright white | Stands out without relying on hue |
| Branch pipes | Dim | Visual structure, not information |

15. **Edge status derivation via `deriveEdgeStatuses`**: A dedicated function in the command layer computes per-edge status using path analysis. It handles: applied (root→marker), pending (marker→target, target→contract), diverged (root→target minus applied/pending), and empty DB (root as effective marker).

16. **`RenderGraph` as the single graph representation**: Built once at the mapping boundary, passed immutably through the pipeline.

17. **Relevant path computation prefers continuity**: When computing paths for the default view, the mapper prefers marker→contract and ref→contract over independent root→contract BFS to avoid routing through unrelated branches.

18. **`colorHint` for domain-agnostic edge coloring**: The renderer applies `colorHint` in preference to role-based coloring (spine/branch/backward).

19. **Contract diagnostic always fires**: The `CONTRACT.AHEAD` diagnostic fires whenever the contract doesn't match the target, regardless of whether a ref is active.

20. **Detached node alignment**: Detached contract nodes align with the bottom-most node in the rendered graph, not the spine target.

# Open Questions

1. **JSON output shape**: Conceptual shape agreed. Exact field names TBD.

2. **Summary line for `--graph` mode**: The default summary ("N pending — run apply") makes sense. What summary is appropriate for `--graph` where multiple branches may have different states?
