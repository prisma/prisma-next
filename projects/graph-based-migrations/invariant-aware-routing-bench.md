# Invariant-aware routing — performance characterisation

How the `findPathWithInvariants` pathfinder behaves across realistic and pathological graph shapes, and what that means for the spec's deferred guard-threshold question.

## TL;DR

The exponential `2^k` factor in the algorithm is real but its constants are small. With the spec's expected single-digit `k` (number of required invariants per ref), routing stays well under perceptible CLI latency on every shape we tested. The cost only becomes uncomfortable at `k ≥ 12` on graphs that have many feature branches rejoining the spine — and even then, "uncomfortable" is hundreds of milliseconds, not seconds.

**No hard guard is warranted for v1.** A hard cap at 30 already exists as a correctness rail (bitmask choice), which sits well past where the cost becomes a problem. A soft `--verbose` heads-up at `k ≥ 16` would be cheap if we want to be polite, but isn't required.

## Methodology

Synthetic graphs from a parameterised generator, run via `vitest bench` against `findPathWithInvariants(graph, root, leaf, required)`. Graph sizes capped at developer-laptop-friendly scales (10k edges max by default). Bench harness lives on the `migration-performance-bench` branch (untracked here); fixture sizes and shape definitions are reproducible.

Three families of shapes:

- **Linear** — the common case. Every node has one outgoing edge. State space is bounded by node count regardless of `k`.
- **Diamond cascade** — the textbook `2^k` worst case. `k` diamonds in series, each with a top edge providing a distinct invariant. Required = all of them ⇒ only the all-top path satisfies; the BFS frontier accumulates `2^k` distinct `(node, covered)` states at the rightmost merge before dedup converges.
- **Realistic** — mostly-linear spine with feature branches that rejoin the spine every few nodes (rate `0.1`–`0.2`). Invariants are sprinkled on edges at a density of `0.05`–`0.20`. This is the shape that matters: it's roughly what a real migration history looks like under active development.

## Numbers

Mean wall time per `findPathWithInvariants` call, varying `k` (number of required invariants):

```
                                        k=1     k=4     k=8     k=16
Strictly linear (1k edges)            0.32ms  0.32ms  0.33ms   0.35ms
Diamond-cascade (k diamonds in a row)     —    6μs    39μs    2.7ms
Realistic (1k spine, 5% density)      0.5ms   2.5ms    26ms   3500ms
Realistic (1k spine, 20% density)     0.5ms   1.1ms    30ms   1900ms
Realistic (10k spine, 5% density)     7.0ms   8.0ms    39ms    414ms
```

`k=0` (no required invariants) is byte-identical to plain `findPath` — we delegate.

## Takeaways

### 1. Linear graphs don't pay the exponential at all

When every node has one outgoing edge, the state space is bounded by node count: only one `(node, covered)` state ever exists per node. `k` is irrelevant. The pure-linear case scales with edge count (the BFS) and nothing else. Most production migration histories are mostly linear.

### 2. The "textbook" `2^k` shape is the wrong thing to worry about

The diamond-cascade case constructs the worst-case BFS state space deliberately, and even at `k=16` it lands at 2.7 ms. The graph itself is small (32 edges) so `2^16` states is cheap to walk. People imagine this case when they hear "exponential", but the constants are negligible.

### 3. Realistic graphs at `k ≥ 8` are where the cost shows up

Mostly-linear spine + feature branches that rejoin = many edges (large baseline) × branching merges (state-space fan-out). At `k=8` we're at 26–40 ms; at `k=16` we're at 100 ms – multiple seconds. Two factors compound:

- Larger graphs cost more even at `k=1` (BFS work scales with `V + E`).
- Branching merges accumulate distinct covered subsets along multiple incoming paths, fanning out the state space.

The exponential dominates the graph-size factor: doubling spine length costs ~10× at `k=1` (linear), but going `k=8 → k=16` costs ~100×.

## Is it bad for us?

For CLI-time routing on a developer laptop, here's what we should expect:

| `k` | Realistic-shape wall time | User perception |
|---|---|---|
| ≤ 5 | < 10 ms | invisible |
| 6 – 10 | 5 – 40 ms | snappy |
| 12 – 16 | 100 ms – few seconds | noticeable but acceptable |
| ≥ 20 | seconds to tens-of-seconds | painful |

For comparison: `migration apply` already runs DDL and data-transform queries against the database, which by themselves cost 10–1000 ms per statement. Pathfinder time stays a small fraction of total apply time up to about `k=12` on realistic graphs.

A typical ref points at "the latest contract hash + the few invariants operationally required for that environment". A user accumulating one invariant per migration with feature-branch backfills might reach 50–100 declared invariants over a project's lifetime, but a single ref usually carries only the few currently relevant. We expect production `k` to sit in the 1–10 range.

## What this means for the deferred guard threshold

The spec parked the question of whether to add a guard threshold (refuse / warn at large `k`) until we had bench numbers. The data says:

- **No hard guard for v1.** The 30-cap is already there for correctness (the bitmask choice doesn't extend past 30 bits without rewriting). It sits well past where wall time becomes uncomfortable.
- **A soft `--verbose` log at `k ≥ 16` would be cheap.** Something like *"resolving 16 required invariants — pathfinding may take a moment"*. Heads-up, not refusal. Skip if we don't want the noise.
- **If real usage pushes `k > 20` routinely, the algorithm needs a different approach** — heuristic A*, dominance pruning, or precomputed reach sets per invariant. All deferrable until we have actual graphs and refs to optimise against, which is a much better basis for picking an algorithm than guessing now.

My recommendation: **ship as-is, no guard.** Realistic-shape numbers show headroom up to `k=12` before users would notice anything. The 30-cap correctness rail gives us a graceful failure mode if anyone ever hits it.

## Notes on the BFS implementation

The pathfinder reuses the generic `bfs` generator in `graph-ops.ts` via its composite-state overload (BFS over `(node, coveredMask)` instead of just node). Going through the generic generator costs ~1.5–2× compared to a hand-rolled inline frontier — the price of going through generator yields + closure indirection — but the curve shape is identical and the broad conclusions are unchanged. If we ever want the missing factor back, inlining `findPathWithInvariants`'s BFS at the cost of mild code duplication is a small, mechanical change.

## Reproducing

The bench harness lives on `migration-performance-bench` at commit `77a46ca8f`, plus the invariant-aware-specific bench cases I've added locally. To re-run:

1. Copy `packages/1-framework/3-tooling/migration/bench/` from `migration-performance-bench` (or from `feat/invariant-aware-routing`'s untracked working tree).
2. Patch the imports for the rename (`src/dag` → `src/migration-graph`, `MigrationChainEntry` → `MigrationEdge`, etc.).
3. Add a temporary `"bench": "vitest bench --run"` script to `packages/1-framework/3-tooling/migration/package.json`.
4. Run `pnpm --filter @prisma-next/migration-tools bench`.

For deeper runs (10k+ edges per shape), set `PN_BENCH_LARGE=1`.
