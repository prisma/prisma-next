# Migration graph benchmarks

Micro-benchmarks for the graph algorithms exported from `@prisma-next/migration-tools/dag`.

## Run

```bash
# From repo root
pnpm --filter @prisma-next/migration-tools bench
pnpm --filter @prisma-next/migration-tools bench:large   # adds 50k-edge linear cases
```

Runs via `vitest bench` (Tinybench). A full default run takes ~40 seconds.

## Layout

- `generators.ts` — parameterised synthetic graph generators. Two construction paths:
  - `buildGraph(shape)` → `MigrationGraph` directly; use when benchmarking traversal ops.
  - `buildBundles(shape)` → `AttestedMigrationBundle[]`; use when benchmarking `reconstructGraph`.
- `dag.bench.ts` — one `describe` block per exported operation, each parameterised over several shapes and sizes so the output exposes scaling behaviour.
- `results/baseline.txt` — committed raw output for regression comparison.

## Graph shapes

| Shape | Parameters | Stresses |
|---|---|---|
| `linear` | `length` | BFS queue scaling, linear history. |
| `diamond` | `branchLength` | Tie-breaking between two equal-length paths. |
| `wide-tree` | `branchingFactor`, `depth` | `findReachableLeaves`, `detectOrphans`, wide fan-out. |
| `merge-heavy` | `spineLength`, `parallelBranches`, `mergeEvery` | `findPathWithDecision` alternative-count loop. |
| `ambiguous-leaves` | `spineLength`, `unmergedBranches`, `branchLength` | `findLeaf` throw path (AMBIGUOUS_TARGET diagnostic). |
| `pathological-cycle` | `length` | `detectCycles` on graphs with a back-edge. |
| `realistic-mixed` | `spineLength`, `featureBranchRate`, `branchLength` | Approximates a real team's linear spine with occasional feature branches. |
| `disconnected-orphans` | `reachableSpine`, `orphanClusters`, `orphanSize` | `detectOrphans` with unreachable subgraphs. |

## Interpreting results

`hz` = operations per second. Higher is better.

Scaling: look at the hz drop across size classes **within a single operation**. For an op that should be O(N):

- 10× graph size → 10× slower: linear, fine.
- 10× graph size → 50× slower: O(N²) tendency; investigate.

## Writing new benchmarks

1. Add a shape variant or new parameter combination to the appropriate `describe` block in `dag.bench.ts`.
2. For a new operation, add a `describe` block and benchmark against shapes that exercise the expected cost driver.
3. Prefer generating the graph **outside** the `bench()` callback so you measure the operation, not construction.

## Known issues (as of baseline run)

See [`docs/planning/benchmarks/migration-graph-baseline.md`](../../../../../docs/planning/benchmarks/migration-graph-baseline.md) for the full analysis.

Remaining low-priority follow-up: `findLeaf`'s `AMBIGUOUS_TARGET` diagnostic path is quadratic-ish in the number of divergent branches — fine for the error case but could be simplified.
