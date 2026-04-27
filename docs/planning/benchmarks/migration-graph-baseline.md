# Migration graph baseline

Performance baseline for the graph-based migration system's core algorithms. Addresses [April milestone, workstream 1, VP3](../april-milestone.md#priority-queue) (graph scales with large contracts) while going deeper on the graph layer specifically, which is where architectural cost is most likely to live.

## Scope

The `MigrationGraph` data structure and its operations, exported from `@prisma-next/migration-tools/dag`, measured directly. The CLI rendering pipeline (which layers on top) is reviewed below by inspection — no separate benchmark run — in the "Rendering pipeline outlook" section. End-to-end `migration status` / `apply` wall-clock (which is IO-dominated) is **not** covered.

**Isolation verdict:** the graph layer is cleanly isolated from migration-specific concerns. Algorithms in [packages/1-framework/3-tooling/migration/src/graph.ts](../../../packages/1-framework/3-tooling/migration/src/graph.ts) operate on strings + opaque edge payloads. The only migration-specific touches are:
1. `sortedNeighbors` uses label priority `main / default / feature` for deterministic tie-breaking.
2. `findLeaf` / `detectOrphans` special-case `EMPTY_CONTRACT_HASH` as the canonical root.
3. `reconstructGraph` accepts `AttestedMigrationBundle[]` but only reads manifest metadata.

None of those prevent direct benchmarking.

## Reproduction

The benchmark harness is not committed in this PR. Numbers in this document were captured from a run against this branch. See the PR body for a pointer to the branch that carries the harness.

Machine: Linux 6.18, Node 24.x, Vitest 4.0.17 / Tinybench. Numbers are indicative — the focus is relative scaling, not absolute wall time.

## Results

`hz` = operations per second. `mean` / `p99` in milliseconds. **Size** is the parameter that scales with graph size for the shape.

### `reconstructGraph`

| Shape | Size (edges) | hz | mean (ms) | p99 (ms) |
|---|---:|---:|---:|---:|
| linear | 10 | 578,509 | 0.002 | 0.004 |
| linear | 100 | 77,421 | 0.013 | 0.027 |
| linear | 1,000 | 6,544 | 0.153 | 0.291 |
| linear | 10,000 | 259 | 3.859 | 8.780 |
| wide-tree (b=5,d=6) | 19,530 | 122 | 8.168 | 14.680 |
| merge-heavy (spine=1000,k=3,every=10) | 3,670 | 1,098 | 0.911 | 1.496 |
| realistic-mixed (spine=1000) | 2,500 | 3,386 | 0.295 | 0.607 |

Scaling on linear: 10 → 10,000 is 1,000× size; observed 2,232× slowdown. **Superlinear (~N^1.1)** but close enough to linear that construction is unlikely to be a bottleneck below 100k edges.

### `findPath` (root → leaf)

| Shape | Size | hz | mean (ms) | p99 (ms) |
|---|---:|---:|---:|---:|
| linear | 10 | 758,731 | 0.001 | 0.003 |
| linear | 100 | 88,641 | 0.011 | 0.021 |
| linear | 1,000 | 7,446 | 0.134 | 0.241 |
| linear | 10,000 | 426 | 2.347 | 5.131 |
| diamond | 100 | 44,241 | 0.023 | 0.042 |
| diamond | 1,000 | 3,749 | 0.267 | 0.497 |
| merge-heavy (spine=100) | 100 | 21,794 | 0.046 | 0.082 |
| merge-heavy (spine=1000) | 1,000 | 1,708 | 0.586 | 0.944 |
| realistic-mixed (spine=1000) | 1,000 | 4,094 | 0.244 | 0.442 |

Scaling on linear: 1,000 → 10,000 is 10× size, observed ~18× slowdown. Close to linear; the small excess reflects generator-dispatch cost that doesn't amortise perfectly across BFS iterations.

### `findPath` (root → random interior)

| Shape | Size | hz | mean (ms) | p99 (ms) |
|---|---:|---:|---:|---:|
| linear | 1,000 | 910,411 | 0.001 | 0.003 |
| linear | 10,000 | 915,691 | 0.001 | 0.003 |
| merge-heavy (spine=1000) | 1,000 | 236,921 | 0.004 | 0.012 |

Each call visits a fraction of the graph (target near the root is cheap, far is expensive); averaged over 16 rotating targets. Constant-looking hz for linear is an artefact of early-exit BFS hitting the target within a few steps.

### `findPathWithDecision` *(precomputed reverse reachability — fixed)*

| Shape | Size | hz | mean (ms) | p99 (ms) |
|---|---:|---:|---:|---:|
| diamond | 100 | 34,755 | 0.029 | 0.048 |
| diamond | 1,000 | 2,284 | 0.438 | 0.737 |
| merge-heavy (spine=100,k=3,every=10) | 100 | 15,241 | 0.066 | 0.122 |
| merge-heavy (spine=1000,k=3,every=10) | 1,000 | **1,067** | **0.937** | **1.409** |
| merge-heavy (spine=1000,k=5,every=100) | 1,000 | 523 | 1.912 | 3.422 |

Previously the alternative-neighbor scan called `findPath(e.to, toHash)` once per outgoing edge along the selected path, making the whole operation O(|path| · (V + E)). Now a single reverse BFS from `toHash` (helper `collectNodesReachingTarget` in [graph.ts](../../../packages/1-framework/3-tooling/migration/src/graph.ts)) builds a `Set<string>` of nodes that reach the target; the per-edge check collapses to O(1) set membership.

Improvement vs baseline on the same benchmark shapes:

- `merge-heavy(spine=1000,k=3,every=10)`: **107×** (100 ms → 0.94 ms per call).
- `merge-heavy(spine=1000,k=5,every=100)`: 15.6×.
- `merge-heavy(spine=100)`: 13.5×.
- `diamond(1000)`: 1.28×.

This path is exercised by every `migration apply` ([cli/src/commands/migration-apply.ts](../../../packages/1-framework/3-tooling/cli/src/commands/migration-apply.ts)), so the user-visible impact on large histories with branching is substantial.

### `findReachableLeaves`

| Shape | Size | hz | mean (ms) | p99 (ms) |
|---|---:|---:|---:|---:|
| wide-tree (b=2,d=12) | 8,190 | 684 | 1.463 | 3.273 |
| wide-tree (b=5,d=6) | 19,530 | 61 | 16.331 | 19.129 |
| wide-tree (b=10,d=4) | 11,110 | 602 | 1.660 | 4.621 |
| ambiguous-leaves (spine=100, branches=10, len=20) | 300 | 57,710 | 0.017 | 0.034 |
| ambiguous-leaves (spine=1000, branches=20, len=50) | 2,000 | 6,703 | 0.149 | 0.270 |

Roughly linear in |V|+|E|. The `wide-tree(b=5,d=6)` case is the worst absolute number because the graph itself is the largest (~19.5k nodes, ~19.5k edges); a tour over every one is unavoidable regardless of how the queue is implemented.

### `findLeaf`

| Shape | Path | Size | hz | mean (ms) | p99 (ms) |
|---|---|---:|---:|---:|---:|
| linear | ok | 100 | 190,656 | 0.005 | 0.011 |
| linear | ok | 10,000 | 820 | 1.219 | 1.744 |
| merge-heavy | ok | 1,000 | 2,747 | 0.364 | 0.590 |
| ambiguous-leaves | **throw** | 100 | 1,281 | 0.780 | 1.322 |
| ambiguous-leaves | **throw** | 1,000 | **13.0** | **76.67** | **79.18** |

**Noted.** The error path is 15,000× slower than the happy path at 1k spine. `findDivergencePoint` builds ancestor sets for each leaf, then calls `findPath` per common ancestor (see `src/graph.ts`). With K unmerged branches sharing the spine, this is O(K · V + C · (V+E)) where C is the number of common ancestors. Only relevant when producing the `AMBIGUOUS_TARGET` diagnostic — infrequent.

### `findLatestMigration`

| Shape | Size | hz | mean (ms) | p99 (ms) |
|---|---:|---:|---:|---:|
| linear | 100 | 60,701 | 0.017 | 0.038 |
| linear | 10,000 | 275 | 3.632 | 8.003 |
| merge-heavy (spine=1000) | 1,000 | 1,020 | 0.980 | 1.470 |
| realistic-mixed (spine=1000) | 1,000 | 2,955 | 0.338 | 0.602 |

Equivalent cost to `findLeaf` + `findPath`. Roughly 2× `findPath` alone, as expected.

### `detectCycles` *(iterative DFS — fixed)*

| Shape | Size | hz | mean (ms) | p99 (ms) |
|---|---:|---:|---:|---:|
| linear | 10 | 857,971 | 0.001 | 0.002 |
| linear | 100 | 100,716 | 0.010 | 0.019 |
| linear | 1,000 | 7,553 | 0.132 | 0.216 |
| linear | **10,000** | **384** | **2.602** | **6.781** |
| pathological-cycle | 100 | 95,339 | 0.011 | 0.019 |
| pathological-cycle | 1,000 | 6,822 | 0.147 | 0.231 |
| merge-heavy (spine=1000) | 1,000 | 1,502 | 0.666 | 1.048 |

Previous recursive DFS in `src/graph.ts` threw `RangeError: Maximum call stack size exceeded` at ~5,000 linear nodes — a correctness bug, not just perf. Rewritten as iterative DFS with an explicit frame stack (three-color algorithm preserved). `linear(10000)` now runs at 2.6 ms/op; previously-working shapes show 0.97–1.00× throughput vs recursive (zero regression).

Regression test in `test/graph.test.ts` runs `detectCycles` against a 20,000-node linear graph and asserts it does not throw.

### `detectOrphans`

| Shape | Size | hz | mean (ms) | p99 (ms) |
|---|---:|---:|---:|---:|
| linear | 1,000 | 13,410 | 0.075 | 0.133 |
| wide-tree (b=5,d=6) | 19,530 | 63 | 15.950 | 18.393 |
| disconnected-orphans (spine=500, 10 clusters × 50) | 1,000 | 17,721 | 0.056 | 0.109 |
| disconnected-orphans (spine=5000, 50 × 100) | 10,000 | 1,169 | 0.855 | 1.842 |

Roughly linear. Wide-tree's absolute number is larger simply because the graph is — ~20k nodes means ~20k visit steps regardless of the BFS implementation.

## Hypotheses (from the plan) — result

1. **`queue.shift()` turns BFS into O(V² + E):** **confirmed and fixed.** Replaced with a head-index cursor in all four BFS sites (`findPath`, `findDivergencePoint`, `findReachableLeaves`, `detectOrphans`). Biggest wins on wide-frontier graphs where the queue holds many nodes at once — `findReachableLeaves` / `detectOrphans` on `wide-tree(b=5,d=6)` (~19.5k nodes) improved **~5.7×**. Linear early-exit shapes improved only ~1.0–1.2× (queue never grew large, so `shift()` was cheap there).
2. **`findPathWithDecision` is O(|path| · (V+E)):** **confirmed and fixed.** Was 200× slower than `findPath`; now runs at ~1 ms per call on merge-heavy(spine=1000) (previously 100 ms). Fix precomputes reverse reachability once via BFS, replacing the per-edge `findPath` call with a set-membership check.
3. **`detectCycles` recursive DFS stack-overflows:** **confirmed and fixed.** Crashed at ~5k linear nodes; now iterative with zero throughput regression on previously-working shapes.

## Recommended follow-ups

Tracked separately (not implemented in this baseline):

- ~~**High:** convert `detectCycles` to iterative DFS.~~ Done.
- ~~**High:** rework `findPathWithDecision` to avoid per-edge re-traversal.~~ Done.
- ~~**Medium:** replace `Array.prototype.shift()` with a head-index cursor~~ Done.
- **Low:** `findLeaf` error-path diagnostic is quadratic-ish in divergent branches — fine for the error case but could be simplified.

## Rendering pipeline outlook

The CLI's graph renderer (`packages/1-framework/3-tooling/cli/src/utils/formatters/graph-render.ts` and friends) sits downstream of the dag operations measured above. Tracing the pipeline by hand — no separate benchmark was run:

| Phase | Shape | Relies on |
|---|---|---|
| `migrationGraphToRenderInput` | O(V + E) + ~5 `findPath` calls | dag layer |
| `extractRelevantSubgraph` | O(P · L + E), P and L small in practice | – |
| `truncateGraph` | O(V + E) BFS reachability | dag-shaped loop |
| **dagre layout** | O(V + E) typical, **O((V+E)²) worst case** | `@dagrejs/dagre` |
| `selectBestVariant` (polyline bends) | O(E · 2^D · L) per edge, D usually ≤ 3 | – |
| Label placement | O(E · small constants) | – |
| ASCII fill | O(bbox_area) | – |

**Normal path is fast.** Truncation runs *before* layout — dagre only ever receives the visible subgraph (default ~10 spine edges plus any relevant forks). Everything upstream is either our already-fast dag ops or constant-factor glue. A 10k-node history has no impact on interactive `migration status` because only the relevant window gets laid out and rendered.

**Risk — `--graph` on a very large graph.** That flag bypasses the default truncation and hands the full graph to dagre. Rank assignment is usually linear but can degrade to O((V+E)²) on dense or highly-crossed inputs. A 10k-node `--graph` render would likely be visibly slow, and the slowness would come from dagre, not from our code. If this ever becomes a user-facing concern, options are: enforce a truncation cap even with `--graph`, warn above a size threshold, or swap layouts at size.

**One non-dag hotspot worth naming.** `selectBestVariant` enumerates 2^D bend combinations per edge, where D is the diagonal-segment count dagre produces. Usually D ≤ 3 (≤ 8 variants). If dagre ever routes an edge through many bends on a dense graph, D could climb; 2^7 starts to matter. Not a concern at the sizes we render today, but worth remembering if we ever feed a much denser graph into the renderer.

The ASCII rendering step itself (`graphRenderer.render`) is proportional to the bounding-box area, which scales with visible nodes — not with the pre-truncation graph. No risk there.
