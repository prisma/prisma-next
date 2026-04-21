# Migration graph bench — scaling report

`build-chart.mjs` reads a single vitest-bench JSON output and emits a
self-contained HTML report with inline SVG log-log charts showing how
each graph operation scales with input size. Useful when inspecting
whether a change preserved, improved, or regressed the asymptotic
behaviour of the dag operations.

## Usage

```bash
# From the migration package dir.
pnpm bench:save                            # writes bench/results/latest.json
node bench/snapshots/build-chart.mjs       # reads that JSON, writes report.html

# Or point the script at any bench JSON:
node bench/snapshots/build-chart.mjs path/to/custom.json
```

Open `bench/snapshots/report.html` in any browser. One chart per
benchmark group (`findPath`, `detectCycles`, …); one coloured series per
shape family (linear, diamond, wide-tree, merge-heavy, …). X-axis is
approximate edge count derived from each benchmark's shape parameters;
Y-axis is mean ms. Both axes log scale. Hover any dot for the exact
value and the underlying benchmark name.

## Notes

- Only benchmarks with ≥1 sample and a finite mean appear. Crashed runs
  (e.g. pre-fix `detectCycles` on 10k-node linear graphs) are silently
  skipped.
- For operations with variant names (`ok · linear(100)`, `throw · …`)
  the inner shape parameters are parsed; the `ok`/`throw` prefix is
  dropped.
- The generated `report.html` is gitignored. So are any `*.json` inputs
  dropped into this directory.

## Adding more size points

The default bench suite has sparse parameter sweeps per shape. If the
scaling plots look too coarse, add more size values to the relevant
`describe` block in `bench/dag.bench.ts` (e.g. more `linear(N)` cases
for a denser scaling curve) and rerun.
