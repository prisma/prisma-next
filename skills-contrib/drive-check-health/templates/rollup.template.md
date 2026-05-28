# Project health rollup: <project-name>

**Cadence:** _<session-bookend / per-slice-merge / trigger-fired (reason)>_
**Date:** _<YYYY-MM-DD HH:MM>_

## Progress

- **Slices delivered:** _N / M_ — _<names>_
- **Slices in flight:** _<names + state>_
- **Slices not started:** _<names>_
- **Direct changes:** _<done / in flight / not started>_
- **Project-DoD coverage:** _<condition-by-condition: met / partially met (which slice will finish it) / not addressed>_

## Drift signals

_Each signal carries a severity: **informational** (surface but no action), **warning** (pattern emerging; consider retro at next merge), **scope-shift-candidate** (recommend mid-flight re-triage)._

- **[severity]** _<signal>_ — _<recommended action>_

## Throughput

- **Dispatches/day:** _N_ (rolling 7d)
- **Median dispatch wallclock:** _<duration>_
- **Median rounds-to-satisfied:** _N_

## Calibration

- **Size prediction accuracy:** _N% predicted-correctly across recent dispatches_
- **Retro-trigger frequency:** _N retros in rolling 7d_ (1/week ≈ healthy; 0 = check the team is actually firing them; > 3/week = something systemic is off)
- **Spike-driven re-plans:** _<count + outcomes>_

## Recommended next pick

1. **<slice / direct-change name>** — _<rationale; operator-availability assumption if any>_
2. _(alternative)_ **<...>** — _<rationale>_

_If the project is blocked (no slice is ready), say so and name the blocker._

## Triggers

_Downstream skill recommendations from Step 5:_

- _Scope-shift candidate → `drive-start-workflow` mid-flight re-triage._
- _Retro trigger → `drive-run-retro`._
- _Project-DoD coverage gap → `drive-plan-project` to amend the plan._
