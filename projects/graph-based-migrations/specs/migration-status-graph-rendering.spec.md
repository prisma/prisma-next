# Summary

Redesign `migration status` output around the principle "show what `migration apply` would do." The default view renders the spine (the path `apply` would take) as a linear chain. An optional `--graph` flag renders the full migration graph with branches, diamonds, and rollback cycles using a Dagre-based ASCII layout.

# Description

`migration status` currently calls `findLeaf(graph)` to pick a single target node, then `findPath(∅ → target)` to produce a linear chain which `formatMigrationStatusOutput` renders as a vertical list. When the graph has multiple leaves (divergent branches — common during team collaboration), `findLeaf` throws `AMBIGUOUS_LEAF` and the command fails before producing any output.

The redesign has two parts:

1. **Default view (spine):** Align the spine target with `migration apply` semantics — contract hash (or ref hash if `--ref`). Render only the path from DB marker (or `∅`) to that target. This answers "what would happen if I run `migration apply` right now?" For long graphs, truncate to the last ~N edges (default N=10?) and show a `⋮` or `...` fade at the top to indicate elided history.

2. **Full graph view (`--graph`):** Render the entire `MigrationGraph` as a topologically-ordered ASCII graph using Dagre for layout. Branches, diamonds, and rollback cycles are all visible. Divergent graphs render successfully instead of erroring. For long graphs, truncation applies here too: find path to target, take the last N nodes, and render only the subgraph reachable from that truncation point.

Both views share the same Dagre-based renderer — the only difference is what graph is passed in. The default view extracts the union of all relevant paths (root→contract, root→DB marker, root→ref) via `extractRelevantSubgraph` and hands the result to the renderer. The `--graph` view passes the full graph. The renderer is agnostic to this distinction.

**Affected code:**
- `cli/src/commands/migration-status.ts` — command logic, spine target resolution, edge status derivation
- `cli/src/utils/formatters/graph-render-dagre.ts` — Dagre-based graph renderer
- `cli/src/utils/formatters/graph-migration-mapper.ts` — migration-to-graph mapper (spine target, markers, status icons)
- `cli/src/utils/formatters/graph-types.ts` — `RenderGraph`, `GraphNode`, `GraphEdge`, `GraphRenderOptions`
- `cli/src/utils/formatters/graph-renderer-types.ts` — `GraphRenderer` interface
- `migration-tools/src/dag.ts` — `findPath`, `findPathWithDecision`
- `cli/src/utils/formatters/migrations.ts` — `formatMigrationStatusOutput` removed; `resolveDisplayChain` and `buildMigrationEntries` are now private to `migration-status.ts`

**Ticket:** [TML-2100](https://linear.app/prisma-company/issue/TML-2100)

# Graph Model

## Terminology

- **Node**: A contract hash representing a database state.
- **Edge**: A migration (from→to) transforming one state to another. Carries: `dirName`, `migrationId`, `createdAt`.
- **Spine**: The path from `∅` to the apply target (contract hash, or ref hash if `--ref`). Analogous to "our current branch" in git terms — it represents what `migration apply` would execute.
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
| DB marker | `◄ DB` |
| Contract marker | `◄ Contract` |
| Ref marker | `◄ ref:name` |
| Detached contract | `◄ Contract (unplanned)` |

User-facing messages use migration-domain language:
- "3 migrations applied, 1 pending"
- "run 'prisma-next migration apply' to apply"
- "database is up to date"
- Not: "spine target is at node X" or "3 edges on the spine"

Part of this task is auditing existing CLI output and error messages for graph jargon leaks and replacing them with user-friendly migration language.

## Edge Status Semantics

Edge status (applied/pending) is derived from two inputs: the **ledger** (what the DB has applied) and the **spine** (the path from the DB marker to the apply target). The status is scoped to the spine — only edges that `migration apply` would execute can be "pending."

- **Applied** (`✓`, cyan): The edge is on the path from `∅` to the DB marker (markerHash). These migrations are recorded in the ledger.
- **Pending** (`⧗`, yellow): The edge is on the spine between the DB marker and the apply target, and has not been applied. These are the migrations `migration apply` would execute.
- **No status** (no icon, dim): Everything else — branch edges, rollback edges, edges on other paths. They are neither applied nor pending. They exist in the graph but are not on the user's apply path.

This means:
- In the **spine view** (default), all visible edges are either applied or pending — that's the whole point.
- In the **full graph view** (`--graph`), spine edges show applied/pending status, branch edges have no status icon.
- In **offline mode** (no DB connection, ledger unavailable), no edges have status — no icons are shown.
- The **ledger** is the source of truth for what has been applied, not the graph structure. The ledger is `undefined` when offline (vs. empty when connected but no migrations applied).

## Two Views

### Default view: relevant subgraph

Renders the minimal subgraph covering all interesting paths: root→contract, root→DB marker (if online), root→ref (if `--ref`). When all targets align (the common case), this is a linear chain. When they diverge (e.g. DB marker on a different branch than the contract), the fork is naturally visible.

The default view uses the same Dagre renderer — it extracts the relevant subgraph via `extractRelevantSubgraph` (union of all target paths) and hands it to the renderer. This means the default view gets the same visual treatment (colors, markers, box-drawing characters) as the full graph view, just scoped to what's relevant.

```
Migration Status
  target: postgresql://user:****@localhost/mydb

  ⋮ (3 earlier migrations)
  │
  ○ def4567
  │ 20260301_add_user  ✓
  ○ abc1234  ◄ DB
  │ 20260302_add_email  ⧗
  ○ ghi7890  ◄ Contract

⧗ 1 pending migration — run 'prisma-next migration apply' to apply
✓ applied  ⧗ pending
```

### Full graph view: `--graph`

Renders the entire migration graph with all branches, diamonds, and cycles visible. Uses Dagre for multi-column layout with box-drawing connectors.

```
∅
│ 20260101_init  ✓
├──────┐
│      │ alice_feature
│      ○ a11ce01
│      │ alice_cleanup
○      ○ b0b0001  ◄ ref:main
│      │
│      └──┐
│         ○ merged  ◄ DB
│ add_index  ⧗
○ abc1234  ◄ Contract
```

## Spine Target Resolution

The spine target aligns with `migration apply`'s destination logic (`--ref` → ref hash, else → contract hash). The contract hash is the right default because the whole point of `migration status` is to show what `migration apply` would do, and `apply` targets the contract hash.

Resolution order:

1. **`--ref` flag active** → ref hash.
2. **Contract hash is a node in the graph** → contract hash. The spine routes from `∅` to the contract hash. This covers linear, diamond, and divergent graphs where the contract is reachable.
3. **Contract hash is not in the graph** (contract ahead — schema changed, no migration planned yet) → fall back to `findReachableLeaves`:
   - **Single leaf** → use it as the spine target. A detached contract node renders below with a dashed connector showing the gap.
   - **Multiple leaves** → the graph is divergent and there is no principled default target. Fall back to full-graph view with a `MIGRATION.DIVERGED` diagnostic guiding the user to `--ref`.
4. **Contract hash is `∅`** (no contract emitted) → no meaningful target. Show "no migrations found" with a diagnostic.

**Why not `findLeaf`?** `findLeaf` throws `AMBIGUOUS_LEAF` on divergent graphs. `migration status` should never hard-fail on a valid graph shape — it's a read-only display command. The contract-hash-first approach avoids this entirely for all common cases. The only truly ambiguous case is a divergent graph where the contract is also ahead of all branches (step 3 above with multiple leaves) — and that's genuinely ambiguous: the user hasn't planned a migration yet and there are multiple possible starting points.

**Why is the multi-leaf fallback necessary at all?** When the contract hash is not in the graph, we can't route to it. We need a graph-internal target for the spine. If there's one leaf, it's unambiguous. If there are multiple, we don't know which branch the user intends to continue from — `migration plan` would ask the same question. Showing the full graph with a diagnostic is the honest answer.

**Consistency with `migration apply`:** `apply` uses the contract hash and fails if there's no path from the marker to it. `status` uses the same target but handles the "no path" case gracefully (detached node, or full-graph fallback) instead of failing.

## Detached Contract Node

When the current contract hash is not in the graph (no migration planned for it yet), render a detached node below the spine leaf with a dashed connector:

```
○ ◄ ref:prod ◄ DB
┊
◇ ◄ Contract (unplanned)
```

**Design decision:** Only one dashed line, always from the spine leaf. The dashed line represents "where `migration plan` would create the next migration if run now."

# Renderer Architecture

## Common renderer interface

All renderers implement a single render method:

```typescript
interface GraphRenderer {
  render(graph: RenderGraph, options: GraphRenderOptions): string;
}
```

The renderer is agnostic to whether it receives a full graph or a filtered subgraph — it renders whatever graph it's given. The caller controls filtering:

- **Default view**: `extractRelevantSubgraph(graph, relevantPaths)` → `renderer.render(subgraph, options)`
- **`--graph` view**: `renderer.render(fullGraph, options)`

`RenderGraph` is an immutable directed graph with adjacency-list indexing, built once from flat `GraphNode[]` and `GraphEdge[]` arrays. It holds forward adjacency, incoming-node sets, and node-by-id lookup — built at the boundary, then passed around as the single graph representation.

A registry/factory function resolves the renderer by name:

```typescript
function getRenderer(name: 'dagre' | 'edge-centric' | 'dot'): GraphRenderer
```

The Dagre renderer's internals are structured as composable building blocks:

- `layoutAndRender(graph, options)` → Dagre layout + ASCII render in a single pipeline
- `extractSubgraph(graph, path)` → `RenderGraph` containing only a single path (legacy, still used in tests)
- `extractRelevantSubgraph(graph, paths)` → `RenderGraph` containing the union of multiple paths
- `truncateGraph(graph, spine, limit)` → truncated `RenderGraph` with marker-aware expansion

The `render` method handles truncation internally (via `findSpinePath` + `truncateGraph` when `options.limit` is set).

## Generic graph interface

The renderer uses the existing canonical types from `graph-types.ts`:

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
  readonly colorHint?: 'applied' | 'pending';
}

interface GraphRenderOptions {
  readonly spineTarget: string;
  readonly rootId?: string;
  readonly colorize?: boolean;
  readonly limit?: number;
}
```

`colorHint` is a domain-agnostic visual hint: the renderer maps `'applied'` → cyan and `'pending'` → yellow (overriding the default role-based edge coloring). The renderer has no knowledge of migration status — it just colors by hint. The mapper is responsible for setting the hint based on edge status semantics (see "Edge Status Semantics" above).

## Migration-specific mapping layer

`migrationGraphToRenderInput` maps `MigrationGraph` + status info onto the generic renderer types. It receives:

- `graph: MigrationGraph` — the full migration graph
- `mode: 'online' | 'offline'` — whether we have DB connectivity
- `markerHash?: string` — DB marker position (from ledger)
- `contractHash: string` — current contract hash
- `edgeStatuses?: EdgeStatus[]` — per-edge applied/pending status (see "Edge Status Semantics")
- `refs?, activeRefHash?, activeRefName?` — ref context

The mapper:

1. **Computes all relevant paths**: `findPath(∅, contractHash)`, `findPath(∅, markerHash)`, `findPath(∅, activeRefHash)`. These paths are returned as `relevantPaths` for the caller to pass to `extractRelevantSubgraph`.
2. **Resolves spine target** (for edge coloring and detached node alignment): `activeRefHash → contractHash → graph leaf`.
3. **Bakes status icons into edge labels**: `✓` for applied, `⧗` for pending (from `edgeStatuses`).
4. **Sets `colorHint`** on edges: applied → cyan, pending → yellow.
5. **Attaches markers** to nodes: DB, contract, refs.

The mapper does not derive edge status itself — it receives pre-computed `edgeStatuses` from the command layer, which has access to the ledger.

## Dagre-based layout

Layout uses the `@dagrejs/dagre` library (Sugiyama framework):

1. **Layer assignment**: Dagre assigns nodes to layers (rows) respecting edge direction
2. **Ordering**: Minimizes edge crossings within layers
3. **Coordinate assignment**: Positions nodes on a grid
4. **Edge routing**: Routes edges through virtual nodes at each layer, producing bend points

The renderer converts Dagre's coordinate output into a character grid, using box-drawing characters (`│`, `─`, `├`, `┐`, `└`, `┘`, `┬`, `┴`, `┼`) based on directional bitmasks at each cell.

## Switchable renderers

All renderers implement the `GraphRenderer` interface (`render(graph, options)`). The Dagre renderer is the default. The edge-centric and DOT renderers are adapted to the same interface so they can be selected at runtime via `--renderer dagre|edge-centric|dot`. This enables side-by-side comparison and demos without code changes.

## RenderEl for ANSI-safe rendering

String rendering uses the `RenderEl` tree structure (from `render-elements.ts`) to separate width calculation from string generation. This prevents alignment bugs caused by ANSI escape codes having visual width 0 but non-zero string length.

## Data flow: `migration status` command

```
MigrationStatusResult (from executeMigrationStatusCommand)
  ├── graph: MigrationGraph
  ├── migrations: MigrationStatusEntry[]  (dirName + status per edge)
  ├── markerHash?: string
  ├── contractHash: string
  └── refs, mode, etc.
         │
         ▼
  knownStatuses(migrations) ──► EdgeStatus[]  (only applied/pending, not unknown)
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
    └── relevantPaths: string[][]  (root→contract, root→marker, root→ref)
         │
         ├─ [default]   extractRelevantSubgraph(graph, relevantPaths) → renderer.render(subgraph, options)
         └─ [--graph]   renderer.render(graph, options)
         │
         ▼
       ASCII string → stdout
```

The command layer derives `EdgeStatus[]` from the `MigrationStatusResult.migrations` array, filtering out `'unknown'` entries. The mapper receives these statuses and bakes them into the graph — it does not compute status itself.

# Requirements

## Functional Requirements

1. **Default spine view**: `migration status` renders the spine path (what `migration apply` would execute) as a linear chain. Labels, markers, and status badges appear on the spine.

2. **Full graph view**: `migration status --graph` renders all nodes reachable from root (`∅`), including branches, merges (diamonds), and rollback edges.

3. **Dagre-based layout**: The full graph view uses Dagre for multi-column layout. Box-drawing characters (`│`, `─`, `├`, `┌`, `└`, etc.) connect nodes across columns.

4. **Edge-based labels**: Migration metadata (dirName, status icon) appears on edge lines between nodes.

5. **Node-based markers**: Ref labels (`◄ ref:name`), DB marker (`◄ DB`), and contract marker (`◄ Contract`) appear inline on the node row.

6. **Spine target alignment**: Spine target matches `migration apply` semantics: `--ref` → ref hash, else → contract hash.

7. **Detached contract node**: When the contract hash has no corresponding migration, show a dashed connector from the spine leaf to a `◇ Contract (unplanned)` node.

8. **Cycle visibility**: Rollback cycles are visible in the full graph view. Backward edges are rendered distinctly (color-coded).

9. **No `findLeaf` crash**: Divergent graphs render successfully in `--graph` mode. The default spine view targets the contract hash, not a leaf.

10. **Offline mode**: Without DB connection, render the graph/spine with no applied/pending distinction.

11. **JSON output**: `--json` includes full graph topology (nodes, edges, per-node status). Exact shape TBD during implementation.

12. **Deterministic output**: Same graph always produces the same output.

13. **Color output**: Status icons, ref labels, graph pipes use ANSI color. `--no-color` disables. Colors must be color-blindness compatible (CVD-safe) — avoid red/green contrast. Meaning is always conveyed by shape/icon first, color reinforces. See Resolved Decisions for the color palette.

14. **Truncation**: Both views truncate long graphs by default. The spine view shows the last N edges with a `⋮` indicator for elided history. The full graph view finds the path to the target, truncates to the last N nodes, and renders only the subgraph reachable from the truncation point. **Default N = 10.** `--limit N` overrides the default. `--all` disables truncation entirely (`limit = undefined`). **Important**: The effective truncation length is `max(limit, distance from earliest relevant marker to target)` — if the contract or DB marker is far behind the target, the truncation window must expand to include it. The markers' positions relative to the target are the most important context in the output; truncating them away defeats the purpose.

## Non-Functional Requirements

1. **Performance**: ≤1000 nodes renders in <100ms.
2. **Terminal width**: Respects terminal width. Default 80 columns when width unavailable.

## Cross-command: `migration plan` needs optional online support

**Discovery context**: While testing `migration status` with the multi-path default view, we found a scenario where `migration plan` produces an unusable migration:

1. User has migrations A→B→C applied (DB marker at C).
2. User changes the contract, runs `migration plan --from B` (creates branch B→D).
3. User changes the contract again, runs `migration plan` (no `--from`).
4. `migration plan` calls `findLatestMigration(graph)` → `findLeaf(graph)`. With two leaves (C and D), `findLeaf` throws `AMBIGUOUS_LEAF`. If there's only one leaf (e.g. D was the only leaf), it picks D as `--from`.
5. The planned migration starts from D, not from C (where the DB is). The resulting migration cannot be applied — `migration apply` would fail because the DB marker is at C, not D.

**Root cause**: `migration plan` is purely offline — it picks `--from` based on the graph leaf, not the DB marker. When the graph has branches, the leaf may be on a different branch than the DB.

**Required fix**: `migration plan` should support an optional `--db` connection (like `migration status` does). When online, the default `--from` should be the DB marker hash instead of the graph leaf. This ensures the planned migration starts from where the DB actually is.

**Why this matters for `migration status`**: `migration status` now correctly shows the DB marker on a different branch than the contract (via multi-path extraction). But if `migration plan` then plans from the wrong starting point, the user sees a correct status display followed by an incorrect plan — the commands tell conflicting stories.

**Alignment principle**: `migration status` shows "what `migration apply` would do." `migration plan` should produce migrations that `migration apply` can actually execute. Both need to agree on the starting point, which means both need to know where the DB is when online.

## Non-goals

- Graph editing/manipulation — read-only display
- Interactive TUI — no scrolling, selection, or keyboard navigation
- Graphviz/DOT/SVG export — ASCII only
- Branch stubs/indicators on the spine view (future extension, not in scope)
- Rewriting `findLeaf` / `findPath` — these remain for `migration plan` and `migration apply`

# Acceptance Criteria

### Spine view (default)
- [ ] Linear chain renders correctly with applied/pending status and markers
- [ ] Spine target matches `migration apply` target (contract hash or ref hash)
- [ ] Detached contract node renders when contract hash is not in graph
- [ ] Offline mode shows spine without status badges
- [ ] Divergent graph does not crash — spine renders to contract hash
- [ ] Long spine (>N edges) truncates with `⋮` indicator for elided history

### Full graph view (`--graph`)
- [ ] Linear chain renders correctly
- [ ] Two forward branches from the same node render in separate columns
- [ ] Diamond (branch then merge) renders fork and convergence with connectors
- [ ] Rollback cycle renders with forward portion and backward edge visually distinct
- [ ] Detached contract node renders with dashed connector from spine leaf
- [ ] Ordering is deterministic: same graph always produces same output
- [ ] Long graph truncates to last N nodes from target with subgraph rendering

### Status labeling
- [ ] Online mode: spine edges up to DB marker show `✓` (applied), spine edges between marker and target show `⧗` (pending)
- [ ] Online mode: off-spine edges (branches, rollbacks) have no status icon
- [ ] Offline mode: no status icons on any edge
- [ ] One-line legend at bottom explains icons (`✓ applied  ⧗ pending`)

### Accessibility
- [ ] Color palette is CVD-safe (no red/green contrast)
- [ ] All meaning is conveyed by shape/icon — color is reinforcement only
- [ ] Output is fully understandable with `--no-color`

### JSON output
- [ ] `--json` includes truncated migration history and apply path as separate fields
- [ ] `--json` includes `truncated: true/false` to indicate whether the history was truncated

### Truncation flags
- [ ] `--limit N` overrides the default truncation length
- [ ] `--all` disables truncation (shows full history)
- [ ] Truncation window expands beyond `--limit` when needed to include contract and DB markers (effective length = `max(limit, earliest-marker-to-target distance)`)

### User-facing language
- [ ] No graph jargon (spine, node, edge, leaf, forward branch) in CLI output, error messages, or diagnostics
- [ ] JSON field names use migration-domain language (not graph internals)

### Tests
- [ ] Unit tests for `render`: linear, branching, diamond, rollback topologies
- [ ] Unit tests for `extractSubgraph` and `extractRelevantSubgraph`: correct node/edge filtering, multi-path union
- [ ] Unit tests for Dagre layout: node positioning, edge routing
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
- `cli/src/commands/migration-apply.ts` — apply target logic (reference for spine target alignment)
- `cli/src/utils/formatters/graph-types.ts` — `GraphNode`, `GraphEdge`, `RenderGraph`, `GraphRenderOptions`
- `cli/src/utils/formatters/graph-migration-mapper.ts` — `migrationGraphToRenderInput`, `EdgeStatus`
- `cli/src/utils/formatters/graph-render-dagre.ts` — Dagre-based `GraphRenderer` implementation
- `cli/src/utils/formatters/graph-renderer-types.ts` — `GraphRenderer` interface, `getRenderer` factory
- `cli/scratchpad-graphs.ts` — shared test graph definitions (35+ topologies)
- `cli/test/utils/formatters/graph-render-dagre.test.ts` — renderer unit and snapshot tests
- `migration/src/dag.ts` — `reconstructGraph`, `findPath`, `findPathWithDecision`
- `git log --oneline --graph` — UX reference point

# Resolved Decisions

1. **Default view is spine, not full graph**: The default `migration status` output shows only the spine — what `migration apply` would do. The full graph is opt-in via `--graph`.

2. **Spine target aligns with `migration apply`**: Contract hash (or ref hash if `--ref`), not `findLeaf`. Fallback chain when contract is not in the graph: single leaf → use it; multiple leaves → full-graph view with `MIGRATION.DIVERGED` diagnostic. This eliminates the `AMBIGUOUS_LEAF` crash and ensures status/apply tell the same story. See "Spine Target Resolution" for the full logic.

3. **Single `render` function, caller controls filtering**: The `GraphRenderer` interface has a single `render(graph, options)` method. The caller decides what graph to pass: the full graph (`--graph`), or a subgraph extracted via `extractRelevantSubgraph` (default view). The renderer is agnostic to the distinction.

4. **Dagre for layout**: Layout uses `@dagrejs/dagre` (Sugiyama framework) rather than a hand-rolled column allocator. This handles complex topologies (nested diamonds, multi-level sub-branches) robustly.

5. **DB marker on a branch node**: The marker's hash determines which edges are applied (edges on the path from `∅` to that hash are applied). Status derivation does not depend on whether the marker is on the spine — it only cares about the path from root to the marker hash.

6. **Orphaned subgraphs**: Error. All nodes must be reachable from root.

7. **Empty graph**: Show `No migrations found` plus detached contract node if contract hash is non-empty.

8. **`--ref` changes spine**: `--ref` changes the spine target (and thus which path is rendered). Different refs produce different spine views.

9. **Renderer location**: `cli/src/utils/formatters/` for now. The generic renderer has no migration dependencies, so it can be extracted to a shared package later.

10. **Branch indicators on spine view**: Not in scope for this spec. Future extension — the spine view would show markers like `(+2 branches)` at fork points.

11. **Off-spine markers as diagnostics**: If DB or contract markers exist on nodes not on the rendered spine, emit a diagnostic/warning rather than rendering them.

12. **Inline labels, not legend-based**: Markers (`◄ DB`, `◄ Contract`, `◄ ref:name`) stay inline on the node row. A legend would require cross-referencing and hurt glanceability. Ref names can be long but are user-chosen — that's acceptable.

13. **Icons only for status, no words**: Edge status uses `✓` (applied) and `⧗` (pending) without the words "Applied"/"Pending". A one-line legend at the bottom of the output explains the icons: `✓ applied  ⧗ pending`. This keeps the graph compact.

14. **CVD-safe color palette**: Colors must not rely on red/green contrast. Shape and icon always carry the meaning; color reinforces.

15. **Edge status is scoped to the spine**: Only edges on the path from `∅` to the apply target receive applied/pending status. Off-spine edges (branches, rollbacks) get no status icon or color hint. This keeps the graph view focused: "here's the full picture, and here's what matters for `apply`." The mapper receives pre-computed `EdgeStatus[]` from the command layer — it doesn't derive status itself.

16. **`RenderGraph` as the single graph representation**: The graph is built once as a `RenderGraph` (nodes + edges + adjacency indexing) at the mapping boundary and passed through the renderer pipeline as a single immutable object. No repeated adjacency map construction. The renderer, subgraph extractor, and truncation logic all operate on `RenderGraph`.

17. **Default view is a multi-path union, not a single spine**: The default `migration status` view extracts the union of all relevant paths (root→contract, root→DB marker, root→ref) via `extractRelevantSubgraph`. When all targets align, this is a linear chain. When they diverge (e.g. DB marker on a different branch than the contract), the fork is naturally visible. The renderer has a single `render` method — the only difference between default and `--graph` is what graph is passed in.

18. **`colorHint` for domain-agnostic edge coloring**: The renderer applies `colorHint` (if present) in preference to role-based coloring (spine/branch/backward). This keeps the renderer generic — it doesn't know about migration status — while letting the mapper control semantic coloring.

| Element | Color | Rationale |
|---|---|---|
| Applied edge/icon (`✓`) | Cyan | Visible to all CVD types |
| Pending edge/icon (`⧗`) | Yellow | High contrast on dark bg, CVD-safe |
| Backward/rollback edge | Magenta | Distinct from cyan/yellow, CVD-safe |
| DB marker (`◄ DB`) | Bold/bright white | Stands out without relying on hue |
| Contract marker | Cyan (planned) / Yellow (unplanned) | Matches applied/pending semantics |
| Ref markers | Dim | Not the primary focus |
| Branch pipes | Dim | Visual structure, not information |

# Open Questions

1. **JSON output shape**: The JSON output includes both the (potentially truncated) migration history and the apply path separately. The history gives the agent the structural picture ("what does the migration graph look like"), and the path gives the actionable answer ("what would `apply` do"). Exact field names TBD during implementation, but conceptually:
   ```json
   {
     "migrations": { "nodes": [...], "edges": [...], "truncated": true },
     "applyPath": ["∅", "abc1234", "def5678", "ghi7890"],
     "markers": { "db": "abc1234", "contract": "ghi7890", "refs": [...] },
     "summary": "..."
   }
   ```

2. **Summary line for `--graph` mode**: The default spine summary ("1 pending migration — run apply") makes sense for the spine view. What summary is appropriate for the full graph view where multiple branches may have different states?

3. ~~**Default truncation limit**~~: Resolved. Default N = 10. `--limit N` overrides; `--all` disables.
