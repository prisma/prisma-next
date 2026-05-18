# drive/plan — project-context for plan authoring

Loaded by `drive-project-plan` and `drive-slice-plan`. Holds prisma-next's dispatch-sizing reference cases, per-dispatch DoR overlays, failure-mode catalogue, and parallelisation heuristics.

## Dispatch-sizing reference cases (calibration)

The default S/M/L/XL sizes (per `drive-slice-plan`) need calibration against this repo's reality. Reference cases for size estimation:

| Reference change | Files touched | LoC | Time (implementer wallclock) | Size |
|---|---|---|---|---|
| _e.g._ Add a single property to an existing contract entity + emit | 2-3 | ~50 | < 30 min | S |
| _e.g._ New operation in an existing operation family | 4-6 | ~150 | ~1 hr | M |
| _e.g._ Cross-package refactor of a frequently-imported helper | 10+ | ~300 | ~3 hr | L → refuse, decompose |

_(Populate as the team gets reference points from real dispatches.)_

## Per-dispatch DoR overlays (beyond canonical)

In addition to the canonical per-dispatch DoR items, prisma-next dispatches must confirm:

- [ ] Affected packages identified (so `pnpm build` of dependent packages can fire as a "done when" gate).
- [ ] Fixture regeneration in-or-out-of-scope decided (`pnpm fixtures:check` either passes or is part of the dispatch).
- [ ] If touching `packages/0-shared` or `packages/1-framework-core`, downstream package builds named as "done when" gates.
- [ ] If the dispatch adds a new public type, the dependent packages' typecheck is named.

## Failure-mode catalogue

Patterns to watch for during a dispatch. Each entry: pattern → consequence → mitigation.

- _e.g._ **Pattern: ungrounded "should work the same" claims about parametric operations.** → Consequence: dispatch ships passing tests on one target but the operation breaks on the others. → Mitigation: brief must name "tests run on which targets"; multi-target operations always run the full target matrix.
- _e.g._ **Pattern: silent fixture regen.** → Consequence: fixtures change but the diff is huge and the reviewer can't tell whether the change is intentional or noise. → Mitigation: regenerate-fixtures is its own dispatch; the diff is reviewed separately.
- _e.g._ **Pattern: a "small refactor" dispatch that touches the contract surface.** → Consequence: silent contract-API change that breaks downstream consumers. → Mitigation: any dispatch that touches contract surface gets the contract-impact DoR overlay.

_(Populated by retros; living.)_

## Parallelisation heuristics

- Slices that touch different operation families in `packages/1-framework-sql/**` typically parallelise well.
- Slices that touch the same adapter (e.g. `packages/3-targets-pg/**`) typically serialise — adapter-internal changes collide.
- Migration-shaped slices (feature flag → dual-write → migrate → remove old path) always serialise; if multiple migration-shaped slices are in flight in the same project, that's a sequencing red flag.

## Common stop-conditions for `drive-build-workflow`

Per-repo stop conditions beyond the canonical ones:

- Any dispatch that would touch `packages/0-shared/contract/types/**` halts for operator review before merge (contract surface is downstream-visible).
- Any dispatch that would change the public surface of `packages/0-shared/exports/**` halts for `drive-discussion` (downstream extensions consume this surface).

_(Operator can add more; treat as living.)_
