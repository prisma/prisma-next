# Migration Status Graph Rendering — Execution Plan

## Summary

Redesign `migration status` to answer "what would `migration apply` do?" by default (relevant subgraph view), with `--graph` for the full migration graph. The renderer uses Dagre for layout, CVD-safe colors, icon-only status with three states (applied/pending/unreachable), truncation with marker-aware expansion, and user-friendly language (no graph jargon in output).

**Spec:** `projects/graph-based-migrations/specs/migration-status-graph-rendering.spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Sævar Berg | Drives execution |

## Milestones

### Milestone 1: Renderer interface and Dagre implementation ✅

Define the `GraphRenderer` interface and implement the Dagre-based renderer. No migration concepts — pure generic graph rendering.

**Deliverable:** Dagre renderer behind a `GraphRenderer` interface with a single `render(graph, options)` method. Exported as `graphRenderer` from `graph-render.ts`.

**Tasks:**

- [x] Define `GraphRenderer` interface in `cli/src/utils/formatters/graph-render.ts` — single `render(graph, options)` method
- [x] Implement Dagre layout + ASCII render pipeline, implementing `GraphRenderer`
- [x] Structure internals as composable functions: `layoutAndRender()`, `extractSubgraph()`, `extractRelevantSubgraph()`
- [x] Apply CVD-safe color palette (cyan=applied, yellow=pending, magenta=unreachable/rollback, bold white=markers, dim=branches)
- [x] Implement marker rendering: `◆ db`, `◆ contract`, ref names inline on node rows
- [x] Implement icon-only status on edges (`✓`/`⧗`/`✗`), no words
- [x] Implement detached contract node with dashed connector (`┊` → `◇`) aligned to bottom-most node
- [x] Implement deterministic output: same input always produces same ASCII
- [x] Nodes with markers always render hash in bold (regardless of spine membership)
- [x] Unit tests: import shared test graphs from `test/utils/formatters/test-graphs.ts`, snapshot all topologies
- [x] Unit tests: color disabled (`colorize: false`) produces correct output without ANSI codes
- [x] Unit tests: detached contract node rendering
- [x] Unit tests: determinism — render same graph twice, assert identical output
- [x] Fix label placement stability: source-proximity penalty and horizontal segment preference

**Note:** `RenderEl` tree was not used — the `CharGrid` class handles ANSI-safe rendering via color-run batching instead. Edge-centric and DOT renderers were deleted (not deferred). The renderer registry was deleted — single renderer, no `--renderer` flag.

### Milestone 2: Truncation ✅

Add truncation logic for long graphs. Both views support `--limit` / `--all` truncation with marker-aware expansion.

**Deliverable:** Both views support `--limit N` / `--all` truncation (default N=10).

**Tasks:**

- [x] Implement `extractSubgraph(graph, path)` — filter nodes/edges to only those on the given path
- [x] Implement `truncateGraph`: given a limit N, keep only the last N edges from the target, show `┊ (M earlier migrations)` indicator
- [x] Implement marker-aware truncation expansion: effective length = `max(limit, distance from earliest relevant marker to target)` — never truncate away contract or DB markers
- [x] Implement `┊` indicator rendering at the top of truncated output
- [x] Unit tests: truncation at various limits (N=1, N=5, N > graph length)
- [x] Unit tests: marker-aware expansion — DB 3 edges behind target with limit=1 expands to 3
- [x] Unit tests: limit=undefined renders full history without truncation indicator
- [x] Snapshot tests: truncated output with `┊` indicator
- [x] Snapshot tests: truncated graph with detached contract node preserved

### Milestone 3: CLI integration ✅

Replace the existing `formatMigrationStatusOutput` pipeline with the new renderer. Wire edge status derivation, relevant path computation, and diagnostics. Add `--graph` flag.

**Deliverable:** `migration status` uses the new renderer. `--graph` shows full graph. Default shows relevant subgraph (multi-path union). Three-state edge status (applied/pending/unreachable). Legend and diagnostics.

**Tasks:**

- [x] Update `migrationGraphToRenderInput` spine target: `activeRefHash → contractHash`, matching `migration apply`
- [x] Implement continuity-aware relevant path computation (marker→contract and ref→contract preferred over BFS root→contract)
- [x] Add `--graph` flag to `migration status` command definition
- [x] Unify renderer API: single `render(graph, options)` method; caller controls filtering via `extractRelevantSubgraph` (default) or full graph (`--graph`)
- [x] Implement `extractRelevantSubgraph(graph, paths)` — union of multiple paths into a subgraph
- [x] Refactor `executeMigrationStatusCommand`: default view extracts relevant subgraph, `--graph` passes full graph; both use `graphRenderer.render()`
- [x] Implement `deriveEdgeStatuses`: applied (root→marker), pending (marker→target, target→contract), unreachable (root→target minus applied/pending), empty DB (root as effective marker)
- [x] Wire applied/pending/unreachable status icons (`✓`/`⧗`/`✗`) and `colorHint` edge coloring via mapper
- [x] Implement `formatLegend` — always shows all three statuses (`✓ applied  ⧗ pending  ✗ unreachable`) right after the graph
- [x] Add summary line and diagnostics after the legend
- [x] Implement contract diagnostic: fires when contract hash is not in the graph (no planned migration produces it). Does not fire when `--ref` points elsewhere but a migration for the contract exists
- [x] Implement diverged-graph diagnostic: "There are multiple valid migration paths — you must select a target"
- [x] Replace `findLeaf` with contract-hash-first target resolution (contract hash → single leaf fallback → diverged full graph)
- [x] Add `--limit N` and `--all` flags to CLI (default limit 10)
- [x] Update `--json` output to strip internal fields before serialization
- [x] Remove `formatMigrationStatusOutput`; privatize `resolveDisplayChain` and `buildMigrationEntries`
- [x] Introduce `RenderGraph` as single graph representation with adjacency-list indexing
- [x] Update existing `migration-status.test.ts` tests to match new output format
- [x] Unit tests: `extractRelevantSubgraph` — multi-path union, deduplication, detached node preservation, marker preservation
- [x] Consolidate to single renderer: delete edge-centric renderer, DOT renderer, renderer registry, `--renderer` flag, `RendererName` type
- [x] Rename `graph-render-dagre.ts` to `graph-render.ts`, export `graphRenderer`
- [x] Move `GraphRenderer` interface into `graph-render.ts` (from deleted `graph-renderer-types.ts`)
- [x] Move shared test graphs from `scratchpad-graphs.ts` to `test/utils/formatters/test-graphs.ts`
- [x] Delete all scratchpad files (`scratchpad.ts`, `scratchpad-dagre.ts`, `scratchpad-edge-centric.ts`)
- [x] Delete `render-fixture.ts` — fixture testing done through CLI directly with switched migration dirs
- [x] Add `dagreOptions` to `GraphRenderOptions` for caller-controlled dagre layout params
- [x] Add `isLinearGraph()` — detect single-chain graphs, pass `ranksep: 1` for compact linear output
- [x] Delete `graph-layout.ts` and dead types (`BranchTree`, `LayoutNode`, `LayoutEdge`, `GraphLayout`)
- [x] Fix `CONTRACT.AHEAD` diagnostic: only fire when contract hash is not in graph (not when `--ref` differs)

**Remaining (deferred):**

- [ ] Implement off-spine marker diagnostics: warn if DB or contract markers are not on the rendered path
- [ ] Audit all CLI output and error messages for graph jargon — replace with migration-domain language (deferred to separate PR)
- [ ] Integration/journey tests for `migration status` (deferred to follow-up)
- [ ] `migration plan` needs optional `--db` support so `--from` defaults to the DB marker when online (see spec)

### Milestone 4: Close-out

Verify all acceptance criteria, clean up, migrate docs.

**Tasks:**

- [ ] Verify all acceptance criteria from spec are met
- [ ] Migrate any long-lived documentation into `docs/` (e.g., graph rendering architecture, color palette decisions)
- [ ] Strip repo-wide references to `projects/graph-based-migrations/**`
- [ ] Delete `projects/graph-based-migrations/`

## Deleted Files (cleanup record)

Files removed during development:

- `cli/scratchpad.ts` — hand-rolled renderer experiment
- `cli/scratchpad-dagre.ts` — Dagre prototype scratchpad
- `cli/scratchpad-edge-centric.ts` — edge-centric renderer prototype
- `cli/scratchpad-graphs.ts` — test graphs (moved to `test/utils/formatters/test-graphs.ts`)
- `cli/scripts/render-fixture.ts` — fixture rendering script (replaced by CLI direct invocation)
- `cli/src/utils/formatters/graph-render.ts` (old) — edge-centric renderer
- `cli/src/utils/formatters/render-elements.ts` — `RenderEl` tree (unused)
- `cli/src/utils/formatters/graph-renderers.ts` — renderer registry
- `cli/src/utils/formatters/graph-renderer-types.ts` — `GraphRenderer` interface (moved into `graph-render.ts`)
- `cli/src/utils/formatters/graph-layout.ts` — pre-Dagre hand-rolled layout engine (dead code)

## Test Coverage

| Acceptance Criterion | Test Type | Milestone | Status |
|---|---|---|---|
| Linear chain renders correctly | Snapshot | M1 | ✅ |
| Target matches apply target | Unit | M3 | ✅ |
| Detached contract node renders | Snapshot | M1 | ✅ |
| Offline mode: no status icons | Snapshot | M1 | ✅ |
| Divergent graph does not crash | Unit + Manual | M3 | ✅ |
| Long graph truncates with `┊` | Snapshot | M2 | ✅ |
| Two forward branches in separate columns | Snapshot | M1 | ✅ |
| Diamond renders fork and convergence | Snapshot | M1 | ✅ |
| Rollback cycle visually distinct | Snapshot | M1 | ✅ |
| Deterministic output | Unit | M1 | ✅ |
| Icons only (`✓`/`⧗`/`✗`) | Snapshot | M1, M3 | ✅ |
| Edge status: applied/pending/unreachable | Unit | M3 | ✅ |
| Legend always shows all three statuses | Unit + Manual | M3 | ✅ |
| CVD-safe colors | Snapshot | M1 | ✅ |
| Shape/icon conveys meaning without color | Snapshot | M1 | ✅ |
| `--limit N` overrides truncation | Unit | M2, M3 | ✅ |
| `--all` disables truncation | Unit | M2, M3 | ✅ |
| Truncation expands for markers | Unit | M2 | ✅ |
| `extractRelevantSubgraph` multi-path union | Unit | M3 | ✅ |
| Existing tests updated | Unit | M3 | ✅ |
| 35+ topology snapshot tests | Snapshot | M1 | ✅ |
| `deriveEdgeStatuses` unit tests | Unit | M3 | ✅ |
| `isLinearGraph` unit tests | Unit | M1 | ✅ |
| No graph jargon in CLI output | Manual audit | M3 | Deferred |
| JSON uses migration-domain language | Integration | M3 | Deferred |
| Integration/journey tests | Integration | Follow-up | Deferred |

## Open Items

- **JSON output exact field names**: Conceptual shape agreed. Exact structure finalized during close-out.
- **Summary line for `--graph` mode**: Default summary ("N pending — run apply") works. Graph summary TBD — possibly "N migrations across K branches, M pending on apply path."
- **Performance with large graphs**: Dagre performance with 1000+ nodes is untested. If perf issues arise, consider pre-filtering before layout.
- **Clean up `test-graphs.ts`**: The test graph fixtures grew organically and could use a review pass — remove redundant topologies, improve naming, ensure each graph has a clear purpose.
