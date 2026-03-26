# Migration Status Graph Rendering — Execution Plan

## Summary

Redesign `migration status` to answer "what would `migration apply` do?" by default (spine view), with `--graph` for the full migration history. The renderer uses Dagre for layout, shared building blocks between both views, CVD-safe colors, icon-only status, truncation with marker-aware expansion, and user-friendly language (no graph jargon in output).

**Spec:** `projects/graph-based-migrations/specs/migration-status-graph-rendering.spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Sævar Berg | Drives execution |

## Milestones

### Milestone 1: Renderer interface and Dagre implementation ✅

Define a common `GraphRenderer` interface that all renderers implement. Lift the Dagre-based renderer from `scratchpad-dagre.ts` as the primary implementation. No migration concepts — pure generic graph rendering.

**Deliverable:** Dagre renderer behind a `GraphRenderer` interface with a single `render(graph, options)` method. Can be selected at runtime via `--renderer dagre`.

**Tasks:**

- [x] Define `GraphRenderer` interface in `cli/src/utils/formatters/graph-renderer-types.ts` — single `render(graph, options)` method
- [x] Create `cli/src/utils/formatters/graph-render-dagre.ts` — lift Dagre layout + ASCII render pipeline from `scratchpad-dagre.ts`, implementing `GraphRenderer`
- [x] Structure Dagre internals as composable functions: `layoutAndRender()`, `extractSubgraph()`, `extractRelevantSubgraph()`
- [x] Apply CVD-safe color palette (cyan=spine, yellow=pending, magenta=rollback, bold white=markers, dim=branches)
- [x] Implement marker rendering: `◆ db`, `◆ contract`, ref names inline on node rows
- [x] Implement icon-only status on edges (`✓`/`⧗`), no words
- [x] Implement detached contract node with dashed connector (`┊` → `◇`)
- [x] Implement deterministic output: same input always produces same ASCII
- [x] Create `cli/src/utils/formatters/graph-renderers.ts` — registry/factory: `getRenderer(name): GraphRenderer`
- [x] Unit tests: import shared test graphs from `scratchpad-graphs.ts`, snapshot all topologies (Dagre renderer)
- [x] Unit tests: color disabled (`colorize: false`) produces correct output without ANSI codes
- [x] Unit tests: detached contract node rendering
- [x] Unit tests: determinism — render same graph twice, assert identical output
- [x] Unit tests: renderer registry returns correct implementation for each name
- [x] Fix label placement stability: source-proximity penalty and horizontal segment preference prevent labels from jumping when layout changes
- [ ] Create `cli/src/utils/formatters/graph-render-edge-centric.ts` — adapt to `GraphRenderer` (deferred, secondary)
- [ ] Create `cli/src/utils/formatters/graph-render-dot.ts` — adapt to `GraphRenderer` (deferred, secondary)

**Note:** `RenderEl` tree was not used — the `CharGrid` class handles ANSI-safe rendering via color-run batching instead. Edge-centric and DOT adapters deferred as secondary. Originally had `renderFullGraph`/`renderSpineGraph` split; unified to single `render()` in M3.

### Milestone 2: Truncation ✅

Add truncation logic for long graphs. Both views support `--limit` / `--all` truncation with marker-aware expansion.

**Deliverable:** Both views support `--limit N` / `--all` truncation (default N=10).

**Tasks:**

- [x] Implement `extractSubgraph(graph, path)` — filter nodes/edges to only those on the given path (done in M1)
- [x] Implement `truncateGraph`: given a limit N, keep only the last N edges from the target, show `┊ (M earlier migrations)` indicator
- [x] Implement marker-aware truncation expansion: effective length = `max(limit, distance from earliest relevant marker to target)` — never truncate away contract or DB markers
- [x] Implement `┊` indicator rendering at the top of truncated output (3 dotted vertical edges with label centered)
- [x] Unit tests: truncation at various limits (N=1, N=5, N > graph length)
- [x] Unit tests: marker-aware expansion — DB 3 edges behind target with limit=1 expands to 3
- [x] Unit tests: limit=undefined renders full history without truncation indicator
- [x] Snapshot tests: truncated output with `┊` indicator
- [x] Snapshot tests: truncated graph with detached contract node preserved

### Milestone 3: CLI integration — wire into `migration status` (in progress)

Replace the existing `formatMigrationStatusOutput` pipeline with the new renderer. Update spine target resolution to align with `migration apply` semantics. Add `--graph` flag.

**Deliverable:** `migration status` uses the new renderer. `--graph` shows full graph. Default shows relevant subgraph (multi-path union).

**Tasks:**

- [x] Update `migrationGraphToRenderInput` spine target: `activeRefHash → contractHash`, matching `migration apply`
- [x] Update `migrationGraphToRenderInput` to compute all relevant paths (root→contract, root→marker, root→ref) and return as `relevantPaths`
- [x] Add `--graph` flag to `migration status` command definition
- [x] Add `--renderer` flag (default: `dagre`) for switching renderers at runtime
- [x] Unify renderer API: single `render(graph, options)` method; caller controls filtering via `extractRelevantSubgraph` (default) or full graph (`--graph`)
- [x] Implement `extractRelevantSubgraph(graph, paths)` — union of multiple paths into a subgraph
- [x] Refactor `executeMigrationStatusCommand`: default view extracts relevant subgraph, `--graph` passes full graph; both use `renderer.render()`
- [x] Add one-line icon legend at bottom of output: `✓ applied  ⧗ pending` (online mode only)
- [x] Add summary line after render
- [x] Update existing `migration-status.test.ts` tests to match new output format
- [x] Add `render-fixture.ts` script for testing with studio migration fixtures
- [x] Introduce `RenderGraph` as single graph representation with adjacency-list indexing
- [x] Wire up applied/pending status icons (`✓`/`⧗`) and `colorHint` edge coloring via mapper
- [x] Replace `findLeaf` with contract-hash-first target resolution (contract hash → single leaf fallback → diverged full graph)
- [x] Add `--limit N` and `--all` flags to CLI (default limit 10)
- [x] Update `--json` output to strip internal fields before serialization
- [x] Remove `formatMigrationStatusOutput`; privatize `resolveDisplayChain` and `buildMigrationEntries`
- [x] Unit tests: `extractRelevantSubgraph` — multi-path union, deduplication, detached node preservation, marker preservation
- [ ] Fix edge status derivation for multi-path view: status icons on off-spine branches when DB marker is on a different branch
- [ ] Implement off-spine marker diagnostics: warn if DB or contract markers are not on the rendered path
- [ ] Audit all CLI output and error messages for graph jargon — replace with migration-domain language (deferred to separate PR)
- [ ] Integration/journey tests for `migration status` (deferred to follow-up)
- [ ] Manual verification: run against `prisma-next-demo` example with real migrations
- [ ] We want less vertical spacing for the linear graph if possible
- [ ] `migration plan` needs optional `--db` support so `--from` defaults to the DB marker when online (see spec)

### Milestone 4: Close-out

Verify all acceptance criteria, clean up scratchpads, migrate docs.

**Tasks:**

- [ ] Verify all acceptance criteria from spec are met
- [ ] **Required cleanup**: Resolve scratchpad files (`scratchpad.ts`, `scratchpad-dagre.ts`, `scratchpad-edge-centric.ts`, `scratchpad-graphs.ts`) — renderers have been lifted into production code; decide whether scratchpads are still useful as standalone dev tools or should be removed. If removed, ensure test graphs are migrated to test files.
- [ ] Resolve `render-fixture.ts` — keep as dev tool or remove (it duplicates some of what the CLI itself does now)
- [ ] Migrate any long-lived documentation into `docs/` (e.g., graph rendering architecture, color palette decisions)
- [ ] Strip repo-wide references to `projects/graph-based-migrations/**`
- [ ] Delete `projects/graph-based-migrations/`

## Test Coverage

| Acceptance Criterion | Test Type | Milestone | Notes |
|---|---|---|---|
| Linear chain renders correctly (spine) | Snapshot | M1, M2 | |
| Spine target matches apply target | Unit + Integration | M2, M3 | |
| Detached contract node renders | Snapshot | M1 | |
| Offline mode: no status icons | Snapshot + Integration | M1, M3 | |
| Divergent graph does not crash | Integration | M3 | |
| Long spine truncates with `⋮` | Snapshot | M2 | |
| Linear chain renders correctly (graph) | Snapshot | M1 | |
| Two forward branches in separate columns | Snapshot | M1 | |
| Diamond renders fork and convergence | Snapshot | M1 | |
| Rollback cycle visually distinct | Snapshot | M1 | |
| Deterministic output | Unit | M1 | |
| Long graph truncates to last N nodes | Snapshot | M2 | |
| Icons only (`✓`/`⧗`), no words | Snapshot | M1 | |
| Spine edges get status, off-spine edges don't | Unit | M3 | Edge status scoping |
| One-line legend at bottom | Integration | M3 | |
| CVD-safe colors | Snapshot | M1 | Verify no red/green |
| Shape/icon conveys meaning without color | Snapshot | M1 | `colorize: false` |
| Understandable with `--no-color` | Snapshot | M1 | |
| JSON includes history + apply path | Integration | M3 | |
| JSON includes `truncated` flag | Integration | M3 | |
| `--limit N` overrides truncation | Integration | M3 | |
| `--all` disables truncation | Integration | M3 | |
| Truncation expands for markers | Unit | M2 | |
| No graph jargon in CLI output | Integration + Manual | M3 | Audit error messages |
| JSON uses migration-domain language | Integration | M3 | |
| `render` topologies | Snapshot | M1 | 35 shared graphs |
| `extractSubgraph` single-path filtering | Unit | M2 | |
| `extractRelevantSubgraph` multi-path union | Unit | M3 | |
| Existing tests updated | Unit | M3 | |

## Open Items

- **JSON output exact field names**: Conceptual shape agreed (`migrations`, `applyPath`, `markers`, `truncated`, `summary`). Exact structure finalized during M3 implementation.
- **Summary line for `--graph` mode**: Spine summary is clear ("1 pending — run apply"). Graph summary TBD — possibly "N migrations across K branches, M pending on apply path."
- **Default truncation limit N**: ~10 edges seems reasonable. Finalize during M2 based on visual testing with real migration histories.
- **Scratchpad disposition**: The 3 scratchpads + shared graph definitions have development value. With renderers lifted into production code behind a common interface, the scratchpads may become redundant. Decision on keep vs. remove deferred to M4 close-out (marked as required cleanup).
- **Performance with large graphs**: Dagre performance with 1000+ nodes is untested. If perf issues arise, consider pre-filtering before layout rather than rendering full graph.
- **Triaged issues from hand-rolled renderer**: The 7 issues in `projects/graph-based-migrations/issue-triage.md` (converging merge drops branch, step-by-step rollback collapsed, wrong connector row, stray pipes, wrong box-drawing char, branch/rollback labels not rendered) are specific to the hand-rolled layout engine. The Dagre approach should resolve most of them by design. Verify during M1 snapshot testing and close out any that are no longer applicable.
