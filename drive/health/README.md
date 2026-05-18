# drive/health — project-context for project-health rollups

Loaded by `drive-health-check` and (via it) `drive-deliver-workflow`. Holds prisma-next's drift-signal thresholds, pick-next heuristics, throughput baselines.

## Drift-signal thresholds

Threshold values for the canonical drift signals (calibrate as the team gathers data):

- **Dispatch crossed M-cap unexpectedly**: actual size > 1.5× predicted.
- **Slice PR scope grew past PR-cap**: > 800 LoC diff OR > 15 files changed.
- **Slice dispatch count exceeded plan**: actual > 2× planned.
- **Failed-dispatch rate**: > 30% of dispatches in rolling 7d window required `ANOTHER ROUND NEEDED` or worse.
- **Long-running in-flight slice**: > 5 calendar days from first dispatch to merge.

Severity defaults:

- 1 signal of any kind: **informational** (surface but no action).
- 2 signals in the same slice OR 1 signal repeating across slices: **warning** (consider retro at next merge).
- 3+ signals OR PR-cap blown OR dispatch-count > 3× plan: **scope-shift-candidate** (recommend `drive-start-workflow` mid-flight re-triage).

## Throughput baselines

Calibrate from operator's historic pace; defaults below are placeholders to be updated.

- **Dispatches/day** (interactive operator, full-time): _~3-5_.
- **Median dispatch wallclock** (M-sized): _~45 min_.
- **Median rounds-to-satisfied**: _~1.5_ (rare 3+ should fire a retro).

## Pick-next heuristics (when multiple slices are ready)

1. **Unblocks others first.** If picking slice A unblocks slices B + C (which can then go parallel), prefer A over a leaf slice.
2. **Operator's flow state.** If the operator is mid-flow on a domain (e.g. just shipped a SQL-emitter slice), the next slice in the same domain has lower context-switching cost.
3. **Risk-reduction first.** If a slice tests a high-risk assumption (per the spec's load-bearing assumptions), prefer it — falsification cheaper now than after fan-out.
4. **Stale slices.** A ready slice that's been sitting > 3 days should go up the queue; staleness corrodes context.

## Common false-positives (signals to ignore in this repo)

- **`pnpm fixtures:check` failure on a dispatch that touched extensions**: not drift; expected; the dispatch should explicitly regenerate. Don't flag unless the regenerate step was missed.
- **Long wallclock on dispatches that include a full `pnpm test:all` run**: not drift; expected when the dispatch touches cross-cutting code.

_(Living; add as the team accrues data.)_
