## Intent

Replace the table-based `migration status` output with an ASCII graph renderer so users can see migration topology — branches, forks, diamonds, and rollback cycles — directly in their terminal. The default view answers "what would `migration apply` do?" by showing only the relevant subgraph (the apply path plus any forks that explain why action is needed). An opt-in `--graph` flag shows the full migration graph. This eliminates the `AMBIGUOUS_LEAF` crash on divergent graphs and introduces three-state edge status (applied/pending/unreachable) so users can see exactly which migrations are actionable.

## Change map

- **Implementation**:
  - [packages/1-framework/3-tooling/cli/src/utils/formatters/graph-render.ts](packages/1-framework/3-tooling/cli/src/utils/formatters/graph-render.ts) — Dagre-based graph renderer (~1300 lines)
  - [packages/1-framework/3-tooling/cli/src/utils/formatters/graph-types.ts](packages/1-framework/3-tooling/cli/src/utils/formatters/graph-types.ts) — `RenderGraph`, `GraphNode`, `GraphEdge`, `GraphRenderOptions`
  - [packages/1-framework/3-tooling/cli/src/utils/formatters/graph-migration-mapper.ts](packages/1-framework/3-tooling/cli/src/utils/formatters/graph-migration-mapper.ts) — Maps `MigrationGraph` → generic `RenderGraph` with markers and status icons
  - [packages/1-framework/3-tooling/cli/src/commands/migration-status.ts](packages/1-framework/3-tooling/cli/src/commands/migration-status.ts) — Command logic: target resolution, edge status derivation, CLI handler rewrite
  - [packages/1-framework/3-tooling/cli/src/commands/migration-plan.ts (L163–L193)](packages/1-framework/3-tooling/cli/src/commands/migration-plan.ts:163-193) — `--from` prefix matching
- **Tests (evidence)**:
  - [packages/1-framework/3-tooling/cli/test/utils/formatters/graph-render.test.ts](packages/1-framework/3-tooling/cli/test/utils/formatters/graph-render.test.ts) — Renderer unit + snapshot tests (35+ topologies)
  - [packages/1-framework/3-tooling/cli/test/utils/formatters/test-graphs.ts](packages/1-framework/3-tooling/cli/test/utils/formatters/test-graphs.ts) — Shared test graph definitions
  - [packages/1-framework/3-tooling/cli/test/commands/derive-edge-statuses.test.ts](packages/1-framework/3-tooling/cli/test/commands/derive-edge-statuses.test.ts) — `deriveEdgeStatuses` unit tests
  - [packages/1-framework/3-tooling/cli/test/commands/migration-plan.test.ts](packages/1-framework/3-tooling/cli/test/commands/migration-plan.test.ts) — `--from` prefix matching tests
  - [packages/1-framework/3-tooling/cli/test/utils/formatters/__snapshots__/graph-render.test.ts.snap](packages/1-framework/3-tooling/cli/test/utils/formatters/__snapshots__/graph-render.test.ts.snap) — 939 lines of snapshot output
  - [test/integration/test/cli-journeys/migration-status-diagnostics.e2e.test.ts](test/integration/test/cli-journeys/migration-status-diagnostics.e2e.test.ts) — 13 diagnostic journey tests (offline, online, divergent, JSON shape)

## The story

1. **Introduce a domain-agnostic graph renderer.** A new `graph-render.ts` module uses Dagre for Sugiyama-style layout (rank assignment + coordinate placement), then stamps the result onto a `CharGrid` — a sparse character canvas that resolves box-drawing junctions, color priority, and label placement. The renderer knows nothing about migrations; it accepts `RenderGraph` (nodes with markers, edges with optional labels and color hints) and produces ASCII output. This is the bulk of new code (~1300 lines).

2. **Define generic graph types as a stable interface boundary.** `graph-types.ts` introduces `RenderGraph` (immutable directed graph with adjacency-list indexing), `GraphNode` (with typed markers: db, contract, ref, custom), `GraphEdge` (with `colorHint` for CVD-safe edge coloring), and `GraphRenderOptions` (spine target, truncation limit, dagre overrides). These types form the contract between the migration-specific mapper and the domain-agnostic renderer.

3. **Build the migration-to-graph mapping layer.** `graph-migration-mapper.ts` translates `MigrationGraph` + CLI status info into `RenderGraph`. It computes relevant paths with continuity-aware routing (tries marker→contract and ref→contract independently, not BFS shortest path from root), bakes status icons (`✓`/`⧗`/`✗`) into edge labels, sets `colorHint` for CVD-safe coloring, and attaches typed markers (db, contract, ref) to nodes.

4. **Rewrite target resolution to eliminate `findLeaf`.** The old code called `findLeaf(graph)` as a fallback, which threw `AMBIGUOUS_LEAF` on divergent graphs. The new resolution chain is: `--ref` hash → contract hash (if in graph) → single reachable leaf → diverged full-graph fallback with a `MIGRATION.DIVERGED` diagnostic. This means `migration status` never crashes on a valid graph shape.

5. **Add three-state edge status derivation.** `deriveEdgeStatuses` uses path analysis across the full graph to assign per-edge status: applied (root→marker path), pending (marker→target path, plus target→contract when a ref is active), and unreachable (root→target edges that are neither applied nor pending — the DB is on a different branch). Empty DB treats root as the effective marker.

6. **Replace the CLI output pipeline.** The old `formatMigrationStatusOutput` (table-based formatter) is removed. The CLI handler now: (a) maps the status result to `RenderGraph` via `migrationGraphToRenderInput`, (b) extracts the relevant subgraph for the default view or passes the full graph for `--graph`, (c) detects linear graphs to use compact layout (`ranksep: 1`), (d) renders via `graphRenderer.render()`, and (e) appends a legend and summary with diagnostics. `--limit`/`--all` flags control truncation (default 10).

7. **Handle edge cases with early bail-outs and diagnostics.** Marker-not-in-graph (DB managed via `db update`) bails out early with recovery hints. Contract-ahead fires when no migration produces the current contract hash. Detached contract nodes render with dashed connectors when the contract is not in the graph.

8. **Add prefix matching for `migration plan --from`.** As a cross-command improvement discovered during testing, `--from` now supports prefix matching (with or without `sha256:` scheme), with disambiguation when multiple candidates match.

## Behavior changes & evidence

- **Adds Dagre-based ASCII graph renderer for migration topology visualization**: Introduces `GraphRenderer` interface with a single `render(graph, options)` method backed by Dagre layout. Supports linear chains, branches, diamonds, rollback cycles, detached contract nodes, and truncation with `┊` elided-history indicator. CVD-safe palette (cyan/yellow/magenta, no red/green). Box-drawing characters for connectors. Deterministic output.
  - **Why**: The old table view could not represent branches, forks, or multi-leaf graphs. Users had no way to see the topology of their migration graph.
  - **Implementation**:
    - [packages/1-framework/3-tooling/cli/src/utils/formatters/graph-render.ts](packages/1-framework/3-tooling/cli/src/utils/formatters/graph-render.ts)
    - [packages/1-framework/3-tooling/cli/src/utils/formatters/graph-types.ts](packages/1-framework/3-tooling/cli/src/utils/formatters/graph-types.ts)
  - **Tests**:
    - [packages/1-framework/3-tooling/cli/test/utils/formatters/graph-render.test.ts (L27–L45)](packages/1-framework/3-tooling/cli/test/utils/formatters/graph-render.test.ts:27-45) — Snapshot tests for all 35+ topologies, determinism, no-color output
    - [packages/1-framework/3-tooling/cli/test/utils/formatters/__snapshots__/graph-render.test.ts.snap](packages/1-framework/3-tooling/cli/test/utils/formatters/__snapshots__/graph-render.test.ts.snap) — 939 lines of snapshot output

- **Adds migration-to-graph mapping with status icons and continuity-aware path computation**: `migrationGraphToRenderInput` translates the migration domain into generic graph types, baking status icons into edge labels and computing relevant paths for the default subgraph view. Path computation tries both marker→contract and ref→contract independently (not root→contract BFS) so diamond topologies show both legs.
  - **Why**: The renderer is domain-agnostic by design. The mapper is the single place where migration semantics (marker position, ref targets, edge status) are projected onto the generic graph types.
  - **Implementation**:
    - [packages/1-framework/3-tooling/cli/src/utils/formatters/graph-migration-mapper.ts](packages/1-framework/3-tooling/cli/src/utils/formatters/graph-migration-mapper.ts)
  - **Tests**:
    - [packages/1-framework/3-tooling/cli/test/utils/formatters/graph-render.test.ts (L99–L157)](packages/1-framework/3-tooling/cli/test/utils/formatters/graph-render.test.ts:99-157) — `extractRelevantSubgraph` multi-path union, deduplication, marker preservation

- **Adds three-state edge status derivation (`deriveEdgeStatuses`)**: Computes applied/pending/unreachable status per edge using graph-wide path analysis. Applied = root→marker. Pending = marker→target (+ target→contract for ref scenarios). Unreachable = root→target edges that are neither — meaning the DB is on a different branch. Empty DB treats root as effective marker.
  - **Why**: The old two-state model (applied/pending on a linear chain) couldn't represent the case where the DB marker is on a different branch from the target. "Unreachable" communicates that `apply` can't reach these edges without the DB first changing branches.
  - **Implementation**:
    - [packages/1-framework/3-tooling/cli/src/commands/migration-status.ts (L148–L220)](packages/1-framework/3-tooling/cli/src/commands/migration-status.ts:148-220)
  - **Tests**:
    - [packages/1-framework/3-tooling/cli/test/commands/derive-edge-statuses.test.ts](packages/1-framework/3-tooling/cli/test/commands/derive-edge-statuses.test.ts) — Linear chain, empty DB, fully applied, branching (unreachable), diamond (no double-count), ref with contract beyond, no contract, off-graph contract
    - [test/integration/test/cli-journeys/migration-status-diagnostics.e2e.test.ts](test/integration/test/cli-journeys/migration-status-diagnostics.e2e.test.ts) — End-to-end validation of applied/pending/unreachable in real scenarios

- **Target resolution replaces `findLeaf` with contract-hash-first fallback chain**: `migration status` no longer calls `findLeaf(graph)`. Target resolution: `--ref` hash → contract hash (if in graph) → single reachable leaf → diverged (full-graph view with `MIGRATION.DIVERGED` diagnostic). Divergent graphs render successfully with all branches visible instead of crashing.
  - **Why**: `findLeaf` throws `AMBIGUOUS_LEAF` on multi-leaf graphs. `migration status` is a read-only display command — it should never hard-fail on a valid graph shape.
  - **Implementation**:
    - [packages/1-framework/3-tooling/cli/src/commands/migration-status.ts (L449–L471)](packages/1-framework/3-tooling/cli/src/commands/migration-status.ts:449-471)
  - **Tests**:
    - Diverged graph handling is tested via the `MIGRATION.DIVERGED` diagnostic path. No dedicated unit test; behavior verified through the command flow.

- **Adds truncation with marker-aware expansion (`--limit` / `--all`)**: Long graphs truncate to the last N edges (default 10) with a `┊ (M earlier migrations)` indicator. Truncation expands beyond the limit when needed to keep contract and DB markers visible. `--all` disables truncation.
  - **Why**: Real-world migration graphs can have hundreds of edges. Truncation keeps the default output focused on the recent, actionable portion while never hiding the user's current position.
  - **Implementation**:
    - [packages/1-framework/3-tooling/cli/src/utils/formatters/graph-render.ts (L1246–L1300)](packages/1-framework/3-tooling/cli/src/utils/formatters/graph-render.ts:1246-1300) — `truncateGraph`, `findSpinePath`, `render` with truncation
  - **Tests**:
    - [packages/1-framework/3-tooling/cli/test/utils/formatters/graph-render.test.ts (L181–L314)](packages/1-framework/3-tooling/cli/test/utils/formatters/graph-render.test.ts:181-314) — Truncation at various limits, marker-aware expansion, detached node preservation, elided indicator rendering

- **Adds `isLinearGraph` for compact linear layout**: Detects single-chain graphs (no branching, ignoring detached nodes) and passes `ranksep: 1` so the output is vertically compact.
  - **Why**: Linear chains are the common case. Without compact layout, Dagre inserts 4 rows between each rank, wasting vertical space for graphs that don't need multi-column layout.
  - **Implementation**:
    - [packages/1-framework/3-tooling/cli/src/utils/formatters/graph-render.ts (L1311–L1317)](packages/1-framework/3-tooling/cli/src/utils/formatters/graph-render.ts:1311-1317)
  - **Tests**:
    - [packages/1-framework/3-tooling/cli/test/utils/formatters/graph-render.test.ts (L317–L357)](packages/1-framework/3-tooling/cli/test/utils/formatters/graph-render.test.ts:317-357) — Single node, linear chain, branching (false), detached nodes (ignored), empty graph

- **Adds marker-not-in-graph early bail-out with recovery diagnostics**: When the DB marker is off-graph and differs from the contract, `migration status` bails out early — no graph is rendered, only a `MIGRATION.MARKER_NOT_IN_GRAPH` diagnostic with actionable hints (db sign, db update, contract infer, db verify). When marker equals contract (both off-graph), proceeds normally — the detached node shows both markers.
  - **Why**: When the marker is off-graph, no edge can be reliably marked as applied. Rendering a full graph with no statuses and misleading diagnostics is worse than a clear error with recovery guidance.
  - **Implementation**:
    - [packages/1-framework/3-tooling/cli/src/commands/migration-status.ts (L516–L555)](packages/1-framework/3-tooling/cli/src/commands/migration-status.ts:516-555)
  - **Tests**:
    - [test/integration/test/cli-journeys/migration-status-diagnostics.e2e.test.ts](test/integration/test/cli-journeys/migration-status-diagnostics.e2e.test.ts) — "marker off-graph, mismatches contract" journey test

- **Adds `MIGRATION.NO_MARKER` diagnostic for fresh databases**: When connected to a database that has no marker row (never initialized), emits a warning with a hint to run `migration apply`. Previously this state was silent — the user saw pending migrations but no explanation of *why* they were pending.
  - **Implementation**:
    - [packages/1-framework/3-tooling/cli/src/commands/migration-status.ts (L562–L569)](packages/1-framework/3-tooling/cli/src/commands/migration-status.ts:562-569)
  - **Tests**:
    - [test/integration/test/cli-journeys/migration-status-diagnostics.e2e.test.ts](test/integration/test/cli-journeys/migration-status-diagnostics.e2e.test.ts) — "fresh DB, migrations exist — MIGRATION.NO_MARKER" journey test

- **Adds `--graph` flag for full migration graph**: The `--graph` flag renders the entire migration graph (all branches, diamonds, cycles) instead of just the relevant subgraph. When the graph is diverged (no single target), `--graph` is used automatically.
  - **Why**: The default view is optimized for "what do I need to do?" The full graph view is for orientation — understanding the overall topology.
  - **Implementation**:
    - [packages/1-framework/3-tooling/cli/src/commands/migration-status.ts (L681–L683)](packages/1-framework/3-tooling/cli/src/commands/migration-status.ts:681-683) — Flag definition
    - [packages/1-framework/3-tooling/cli/src/commands/migration-status.ts (L724–L725)](packages/1-framework/3-tooling/cli/src/commands/migration-status.ts:724-725) — Routing: `--graph` or diverged → full graph, else → relevant subgraph
  - **Tests**:
    - Full-graph rendering is exercised by the snapshot tests for all topologies in `graph-render.test.ts`.

- **Adds prefix matching for `migration plan --from`**: `--from` now supports prefix matching with or without the `sha256:` scheme. Ambiguous prefixes (matching multiple migrations) return a clear error.
  - **Why**: Users copy short hashes from `migration status` output and should be able to use them directly.
  - **Implementation**:
    - [packages/1-framework/3-tooling/cli/src/commands/migration-plan.ts (L163–L193)](packages/1-framework/3-tooling/cli/src/commands/migration-plan.ts:163-193)
  - **Tests**:
    - [packages/1-framework/3-tooling/cli/test/commands/migration-plan.test.ts (L248–L388)](packages/1-framework/3-tooling/cli/test/commands/migration-plan.test.ts:248-388) — Prefix without scheme, prefix with scheme, ambiguous prefix rejection

- **Removes `formatMigrationStatusOutput` and privatizes helpers**: `formatMigrationStatusOutput` (the old table formatter) is deleted from `migrations.ts`. `resolveDisplayChain` and `buildMigrationEntries` are made module-private (no longer exported). No behavior change — these were only consumed internally.
  - **Implementation**:
    - [packages/1-framework/3-tooling/cli/src/utils/formatters/migrations.ts](packages/1-framework/3-tooling/cli/src/utils/formatters/migrations.ts)
    - [packages/1-framework/3-tooling/cli/src/commands/migration-status.ts](packages/1-framework/3-tooling/cli/src/commands/migration-status.ts) — `buildMigrationEntries` and `resolveDisplayChain` now `function` (not `export function`)

- **Replaces graph jargon in user-facing messages**: "edge(s)" → "migration(s)" in ref distance summaries. "marker" → "database marker" in no-path message. `MIGRATION.MARKER_DIVERGED` → `MIGRATION.MARKER_NOT_IN_GRAPH` with clearer messaging. No behavior change beyond wording.
  - **Implementation**:
    - [packages/1-framework/3-tooling/cli/src/commands/migration-status.ts (L793–L808)](packages/1-framework/3-tooling/cli/src/commands/migration-status.ts:793-808)

- **Adds `@dagrejs/dagre` dependency**: New production dependency for graph layout.
  - **Implementation**:
    - [packages/1-framework/3-tooling/cli/package.json](packages/1-framework/3-tooling/cli/package.json) — `"@dagrejs/dagre": "^3.0.0"`

## Compatibility / migration / risk

- **Breaking change to CLI output format**: `migration status` output changes from a table to an ASCII graph. Scripts parsing the old table format will break. The `--json` output is preserved and should be used for programmatic consumption.
- **JSON output shape expanded**: `MigrationStatusResult` gains internal fields (`graph`, `bundles`, `edgeStatuses`, `activeRefHash`, `activeRefName`, `diverged`) but they are stripped before JSON serialization. The `--json` output shape is backward-compatible except that `MigrationStatusEntry.status` now includes `'unreachable'` in addition to `'applied' | 'pending' | 'unknown'`.
- **Diagnostic code renamed**: `MIGRATION.MARKER_DIVERGED` → `MIGRATION.MARKER_NOT_IN_GRAPH`. Any automation matching on diagnostic codes will need updating.
- **`findLeaf` no longer called from `migration status`**: The `AMBIGUOUS_LEAF` error can no longer be triggered by `migration status`. This is intentional — divergent graphs now render successfully.
- **New dependency**: `@dagrejs/dagre ^3.0.0` added to the CLI package. Pure JS, no native modules.
- **Performance**: Dagre performance with 1000+ nodes is untested (spec targets <100ms). This is noted as an open item.

## Known issues

- **`deriveEdgeStatuses` uses graph path, not ledger, for applied status** (high): After `db update`, edges show as `✓ applied` even though no migrations were executed. Requires adding `readLedger()` to the control plane stack and threading `dirName`/`migrationId` through the runner. See [issue triage](projects/graph-based-migrations/issue-triage.md).
- **Cross-branch contract diagnostic gap** (medium): When `--ref staging` is used and the contract is reachable only from a different branch, no diagnostic fires. The detached contract node also renders on the wrong branch.
- **Unreachable vs. backward edge color overlap** (low): Both use magenta. These are different concepts and should be visually distinct.
- **`MigrationStatusResult` conflates internal and public shapes** (medium): The `--json` handler manually strips internal fields. A dedicated public shape type would provide compile-time safety.

## Follow-ups

- **User-facing language audit**: Deferred to a separate PR ([TML-2097](https://linear.app/prisma-company/issue/TML-2097)) — some internal terms ("spine", "leaf") may still appear in edge cases.
- **JSON output field names**: Exact shape agreed conceptually but not finalized.
- **`migration plan` needs optional `--db` support**: So `--from` defaults to the DB marker when online, preventing unusable migrations.
- **Integration/journey tests for `migration status`**: Added — 13 diagnostic journey tests in `migration-status-diagnostics.e2e.test.ts`.

## Non-goals / intentionally out of scope

- **Interactive TUI**: No scrolling, selection, or keyboard navigation.
- **Graphviz/DOT/SVG export**: ASCII only; DOT renderer was deleted.
- **Graph editing/manipulation**: Read-only display.
- **Rewriting `findLeaf` / `findPath`**: These remain for `migration plan` and `migration apply`.

## Sources

- Linear: [TML-2100](https://linear.app/prisma-company/issue/TML-2100)
- Spec: [migration-status-graph-rendering.spec.md](projects/graph-based-migrations/specs/migration-status-graph-rendering.spec.md)
- Plan: [migration-status-graph-rendering-plan.md](projects/graph-based-migrations/plans/migration-status-graph-rendering-plan.md)
- Issue triage: [issue-triage.md](projects/graph-based-migrations/issue-triage.md)
