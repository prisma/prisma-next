# Invariant-aware routing — performance characterisation

How `findPathWithInvariants` behaves across realistic and pathological shapes, and what that means for the deferred guard-threshold question.

## TL;DR

Production-typical inputs stay sub-millisecond on every shape we tested. Pathological inputs (high feature-branch density, many required invariants) degrade onto the `2^k` curve, but those inputs require something close to a synthetic worst case to materialise — production won't generate them after F13's `effectiveRequired = ref.invariants − marker.invariants` subtraction collapses `k` to 0 or 1 in steady state.

**No hard guard is warranted for v1.** A soft `--verbose` heads-up at `k ≥ 16` would be cheap if we want the polite signal, but isn't required.

## What the pathfinder actually receives in production

Per spec F13 the value the CLI threads into `findPathWithInvariants` is `effectiveRequired = ref.invariants − marker.invariants` — the delta the ref has grown since the last successful apply against this database. In steady state that's:

- **0** (ref unchanged ⇒ short-circuits to `findPath`), or
- **1** (one new invariant introduced this PR).

Higher `k` requires either a fresh database catching up to a long-applied ref, or a ref that was edited extensively without ever being applied. Both are exceptional, not typical.

Migration histories themselves are overwhelmingly **sticks** — linear chains of edges with the occasional rejoining feature-branch detour. Branchy graphs at the densities the worst-case bench panels use (10–20 % feature-branch rate per spine node) don't correspond to any real `migrations/` directory.

So the dominant production input is: **stick or mostly-stick graph + k ≤ 1.** That's what the bench leads with; the rest is boundary characterisation.

## Methodology

Synthetic graphs from a parameterised generator, run via `vitest bench` against `findPathWithInvariants(graph, root, leaf, required)`. Graph sizes capped at developer-laptop-friendly scales (10k edges max by default; `PN_BENCH_LARGE=1` extends to 50k). Bench harness reuses the earlier graph-perf work plus invariant-specific cases, kept untracked on this branch.

Two tiers of shapes:

### Production-typical
- **`stick`** — linear chain of N edges with one invariant on the latest edge. Effective `k=1`.
- **`mostly-stick`** — linear spine with rare rejoining detours (5 % branch rate). `k=1` or `k=2`.

### Worst-case boundary (synthetic, not seen in production)
- **`linear-invariants`** — stick with k invariants spread along the spine, all required. Sweeps k against a no-fan-out graph; isolates per-state-key cost from state-space growth.
- **`diamond-cascade`** — k diamonds in series, each top edge providing a distinct invariant. The textbook `2^k` worst case.
- **`branchy-invariants`** — high feature-branch density (10–20 %) with invariants sprinkled at 5–20 % per edge. Combines large constants (V, E) with state-space fan-out.

## Numbers

Mean wall time per `findPathWithInvariants` call against the current `Set<string>` covered-set encoding. Captured 2026-04-30, developer laptop.

### Production-typical

| Case | Wall time |
|---|---:|
| `stick(n=50) · k=1` | 0.023 ms |
| `stick(n=200) · k=1` | 0.094 ms |
| `stick(n=1000) · k=1` | 0.496 ms |
| `mostly-stick(spine=200, rate=0.05) · k=1` | 0.102 ms |
| `mostly-stick(spine=200, rate=0.05) · k=2` | 0.215 ms |
| `mostly-stick(spine=1000, rate=0.05) · k=1` | 0.552 ms |
| `mostly-stick(spine=1000, rate=0.05) · k=2` | 1.20 ms |

Empty-required short-circuit (delegates to `findPath`): identical to plain `findPath` cost across linear/diamond/merge-heavy/realistic-mixed shapes (~0.2–3.5 ms depending on graph size).

### Worst-case boundary

| Case | Wall time |
|---|---:|
| `diamond-cascade(count=4) · all` | 0.010 ms |
| `diamond-cascade(count=8) · all` | 0.103 ms |
| `diamond-cascade(count=12) · all` | 0.896 ms |
| `diamond-cascade(count=16) · all` | 8.37 ms |
| `linear-invariants(n=1000, k=4)` | 0.98 ms |
| `linear-invariants(n=1000, k=16)` | 1.82 ms |
| `branchy(spine=1000, density=0.05) · k=4` | 7.07 ms |
| `branchy(spine=1000, density=0.05) · k=8` | 79.9 ms |
| `branchy(spine=1000, density=0.05) · k=16` | 8740 ms |
| `branchy(spine=10000, density=0.05) · k=16` | 1450 ms |

The branchy panel is where the `2^k` curve is genuinely visible. Diamond-cascade stays small in absolute terms despite being the textbook worst case because its graph is small (32 edges); the per-state cost is cheap, only the state count matters.

## Design choice: `Set<string>` covered-set, not a bitmask

Earlier versions of this implementation used a 30-bit unsigned mask over a sorted enumeration of `required`, with a per-call edge-mask cache and a hard cap at 30. That encoding was faster per state-key operation but introduced enough machinery (mask setup, edge-mask cache, the cap-throw guard, a state-key collision regression test) that the simplification of going to a `Set<string>` covered-set was worth the cost.

Bitmask vs `Set<string>`, on the same shapes, captured back-to-back:

| Case | Bitmask (ms) | Set (ms) | Ratio |
|---|---:|---:|---:|
| **Production-typical** | | | |
| `stick(n=200) · k=1` | 0.065 | 0.094 | 1.44× |
| `stick(n=1000) · k=1` | 0.349 | 0.496 | 1.42× |
| `mostly-stick(spine=1000) · k=1` | 0.418 | 0.552 | 1.32× |
| `mostly-stick(spine=1000) · k=2` | 0.419 | 1.20 | 2.87× |
| **Boundary** | | | |
| `linear-invariants(n=1000, k=16)` | 0.350 | 1.82 | 5.21× |
| `diamond-cascade(count=16) · all` | 2.71 | 8.37 | 3.09× |
| `branchy(spine=1000, density=0.05) · k=16` | 3676 | 8740 | 2.38× |

The dominant cost the encoding change pays for: `stateKey` is now `${node}\0${[...covered].sort().join('\0')}`, which is `O(k log k)` per call vs `O(1)` for the bitmask's `${node}\0${mask}`. On a stick at k=16 (where BFS visits exactly N states regardless of k) this manifests as a clean linear factor — bitmask stayed flat at ~0.35 ms across k=1–16, Set grows from 0.5 ms to 1.8 ms. On state-space-bounded shapes (diamond-cascade, branchy) the per-state cost difference plateaus around 3× because the bench is already drowning in `2^k` work.

What the change buys:
- ~75 lines of supporting machinery deleted (mask setup, edge-mask cache, comparator's numeric `useful` key).
- The 30-cap throw guard and its test gone — `Set<string>` has no length ceiling.
- The state-key collision class gone — invariant ids never contain `\0`, so sorted-join keys are unambiguous regardless of node-name length. The regression test for that class of bug deleted.
- One less reason to think about JS bitwise semantics when reading the code.

What it costs:
- Production cases ~1.4× slower in absolute terms — still well under 1 ms on every shape.
- Boundary k=16 cases up to ~5× slower in the worst row, still completing on inputs that don't reach production.

The trade is favourable because production never sees the cases where the cost shows up, and the simpler code is easier to maintain.

## Is it bad for us?

For CLI-time routing on a developer laptop, here's what to expect against the current `Set<string>` encoding:

| `k` (effective, after marker subtraction) | Stick / mostly-stick wall time | User perception |
|---:|---|---|
| 0 (most common) | identical to `findPath` | invisible |
| 1 (typical when introducing an invariant) | < 1 ms | invisible |
| 2 | 1–2 ms on 1k spines | invisible |
| 4–8 | 5–80 ms on synthetic branchy graphs | snappy, but production won't reach this |
| 16+ | seconds on synthetic branchy graphs | painful, but production won't reach this |

For comparison: `migration apply` already runs DDL and data-transform queries against the database, which themselves cost 10–1000 ms per statement. The pathfinder's contribution to total apply time is negligible at production-typical k.

## What this means for the deferred guard threshold

The spec parked the question pending bench data. The data says:

- **No hard guard for v1.** Production-typical k is 0 or 1; both stay sub-ms. There's no input the CLI will encounter that the routing layer can't handle.
- **A soft `--verbose` log at `k ≥ 16` would be cheap.** Something like *"resolving 16 required invariants — pathfinding may take a moment"*. Heads-up, not refusal. Skip if we don't want the noise.
- **If real usage ever pushes `k > 20` routinely, the algorithm needs a different approach** — heuristic A*, dominance pruning, or precomputed reach sets per invariant. All deferrable until we have actual graphs and refs to optimise against.

My recommendation: **ship as-is, no guard.** Production-typical numbers leave plenty of headroom; the worst inputs the bench characterises don't correspond to anything the routing layer will receive in practice.

## Reproducing

The bench harness reuses the earlier graph-perf work plus invariant-specific cases, kept untracked on this branch. To re-run:

1. Copy `packages/1-framework/3-tooling/migration/bench/` from this branch's working tree (or from the underlying graph-perf branch).
2. Add a temporary `"bench": "vitest bench --run"` (and optionally `"bench:save": "vitest bench --run --outputJson=bench/snapshots/latest.json"`) script to `packages/1-framework/3-tooling/migration/package.json`.
3. Run `pnpm --filter @prisma-next/migration-tools bench` (or `bench:save` to capture a JSON snapshot).
4. For deeper runs (50k+ edges), set `PN_BENCH_LARGE=1`.

Snapshots used for the bitmask-vs-Set comparison above live at `bench/snapshots/01-bitmask.json` and `bench/snapshots/02-set-string.json` in the local working tree.
