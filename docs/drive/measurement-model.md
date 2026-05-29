# Drive — measurement model

How a Drive run is measured. Drive runs emit a structured `trace.jsonl` (see the `drive-record-traces` skill) from which deterministic invariant assertions and diagnostic metrics are computed (see the `drive-diagnose-run` skill). This document defines the model those tools implement: what counts as a good run, how the axes relate, and which diagnostics are reported alongside.

The model has two layers. The **deterministic layer** — everything computable straight off the trace — is implemented today. The **qualitative layer** — an LLM judge for the intent rubric, failure-mode classification, operator-turn classification, plus a controlled-experiment A/B harness — is tracked separately and slots in alongside the same trace contract.

The framing is **floor-raising, not benchmark-maxxing.** The point is to surface the failure patterns that actually hurt (artefact churn, dispatch rework, pathological backtracks, operator rescues) so the drive-* skills can be tuned with measurement-driven feedback instead of complaint-driven feedback. The headline is always the diagnostic dashboard — *which 1% fails, and why* — never a single composite score.

## Correctness is a gate; speed is the optimisation target

The naive framing treats operator-involvement minutes as the primary metric. That is wrong: a Drive run can already proceed largely unattended — the problem is that runs take *too long*, burning tokens re-reading and re-writing artefacts. The speed of arriving at a *correct* result matters more than minimising operator turns. Operator-time stays as a diagnostic (it catches over-asking and wrong-altitude responses), but the headline shape is:

- **Correctness** is a gate. A run that fails correctness does not enter the speed comparison.
- **Speed** (wall-clock primary, tokens secondary) is the optimisation target *conditional on* the gate.

This matches how SWE-bench and most agent benchmarks worth copying are structured. Single-axis metrics hide where the failure modes live.

## Correctness has three layers

| Layer | Checks | Mechanism |
|---|---|---|
| Mechanical | typecheck, tests, lint, fixtures | Run the gates. Binary. |
| Requirements | the brief's stated outcomes hold | Per-brief acceptance set (each brief ships with its own). Binary. |
| Intent | the spirit of the brief was delivered | LLM judge with calibrated rubric. Continuous 0–1; threshold at 0.8 for the gate. |

A run is `CORRECT` iff mechanical + requirements pass and intent ≥ 0.8. Intent stays continuous in the dashboard for trend analysis even though it's thresholded for the gate.

Mechanical + Requirements are deterministic — read from the emitted trace plus the brief's acceptance set. Intent requires the qualitative judge layer.

## Speed has two numbers, in priority order

1. **Wall-clock to merge** — the headline.
2. **Total tokens** — broken down by tier (orchestrator / mid / cheap).

Both reported as distributions (p50, p90), not means. Variance matters as much as central tendency for methodology comparison — a config that's fast 50% of the time and stalls 50% of the time is worse than a consistently mid-pace one with the same mean. Both are deterministically computable from the trace's per-event timestamps and tier-tagged token counts.

## Composite for ranking — decision-time only, never the headline

When ranking two configs requires a single scalar:

```
expected_wallclock_to_correct_run = E[wallclock | CORRECT] / P(CORRECT)
```

Lower is better. Penalises rare success proportionally to how rare it is — the standard ML-ops shape.

**The composite is a decision-time tool, used sparingly** — e.g. when picking between two candidate skill versions in a controlled A/B and the diagnostics are ambiguous. It is **never** the iteration headline. The litmus test is "if 1% fails, which 1%?" — the diagnostic dashboard answers that; the composite hides it. The headline is always the tuple `(P(CORRECT), wallclock_p50, wallclock_p90, tokens_p50)` plus the diagnostic decomposition. Computing the composite requires the intent gate, so it belongs to the qualitative layer; even there it is the secondary ranking tool, not the dashboard headline.

## Diagnostics

Six diagnostic families, always reported alongside the headline:

1. **Artefact churn.** Write amplification (total bytes written / final bytes), time-to-stability, re-read count, cross-artefact contamination. This is the failure mode the model exists to surface; it gets first-class treatment.
2. **Phase distribution.** Share of wall-clock in specify / plan / build / review / close. The "front-load design" hypothesis is observable here: if it's working, `specify + plan` grow as share, `build` shrinks, total shrinks.
3. **Dispatch rework.** First-pass acceptance rate; rounds per dispatch (p50, p90, max); high-round slices flagged as sharpening candidates. Each round costs a full validation-gate re-run plus an executor↔reviewer message round-trip.
4. **Backtracks.** Legitimate (DoR refusals + halt-and-route-to-discussion when a load-bearing assumption is falsified) vs pathological (post-execution retry + post-merge revert). The ratio is its own diagnostic — a high legitimate ratio means gates fire in the right places.
5. **Operator turns.** Five buckets (legitimate-design / legitimate-authz / illegitimate-asked / illegitimate-correction / illegitimate-rescue). The deterministic layer reports raw counts only; classification into buckets is the qualitative judge's job.
6. **Tier mix.** Tokens consumed at orchestrator / mid / cheap tiers. Smaller dispatches should grow the cheap-tier share materially.

## Interactions between metrics matter

The intent-score × rounds-per-dispatch cross-table is diagnostic in a way neither metric is on its own:

| Rounds | Intent | Diagnosis |
|---|---|---|
| Low | High | One-shot success (best case) |
| High | High | Brief under-specified; eventually right. **Sharpen the brief.** |
| High | Low | Reviewer catching problems but can't get the executor there. **Re-decompose / discuss.** |
| Low | Low | Reviewer rubber-stamping. **Worst case — passes DoD without catching drift.** |

The fourth row is the silent killer; tracking both metrics catches it. The cross-table needs `rounds_per_dispatch` (deterministic) plus the intent judge (qualitative) — both layers must land to make the diagnosis legible.

## Falsification predictions

A measurement framework earns its keep by falsifying-or-confirming methodology changes that were made without instrumentation. The 2026-05-28 artifact-cascade redesign (see [`design-decisions/2026-05-28-artifact-cascade-redesign.md`](./design-decisions/2026-05-28-artifact-cascade-redesign.md)) was a major qualitative shift; once enough instrumented runs accumulate, these six predicted shifts become checkable:

1. Brief write-amplification drops toward ~1.0× (was higher when briefs were 200+ lines with rewrites).
2. Project-spec stability — stable within a couple of hours of first creation (vs mutating throughout the project).
3. Phase mix — `specify + plan` share grows; `build` share shrinks; total shrinks.
4. Tier mix — cheap-tier token share grows materially.
5. Pathological backtrack rate drops.
6. First-pass dispatch acceptance rate rises.

These are outcomes of the iteration loop the instrumentation enables, not deliverables of the instrumentation itself.

## Design rationale

The decisions that shaped the measurement approach, with the alternatives considered.

### The ProjectRun is the unit of measurement, anchored on the orchestrator-agent ID

A `ProjectRun` is the unit measured. It is anchored on the orchestrator-agent ID (the per-session transcript UUID — known by construction for live runs via the SDK; extractable from the agent-transcripts directory for retrospective runs). Linear is **informational only** — issue/project status changes annotate the report but are never the source of truth for ProjectRun boundaries or any computed metric.

- **Why.** Linear is frequently stale or absent; branch-anchoring breaks because a project typically spans multiple branches (one per slice). The orchestrator-agent ID is the only stable identifier across the life of a run.
- **Alternatives rejected.** Linear-anchored (kept informational, not load-bearing); branch-anchored (multi-branch projects break it).

### ProjectRun boundaries are delimited by skill-invocation signals, with the detection method exposed

A single orchestrator can host many ProjectRuns interleaved (projects, orphan slices, direct changes, retros, methodology work). Boundaries are delimited by two complementary detectors:

- **Skill-boundary** (primary, mechanical). Opening/closing a project run maps to the lifecycle skills (project create/close; orphan-slice spec opens, slice-PR merge closes).
- **Operator-marker** (fallback). Operator-authored markers ("Starting project X", "Closing out project X") detected when the skill-boundary signal is absent.

Each ProjectRun records `detection_method: "drive-skill-boundary" | "operator-marker" | "session-boundary-fallback"` so the report flags runs delimited by weaker evidence honestly.

- **Alternatives rejected.** Session boundary (`/new`) alone — multi-session projects break it.

### Observation from inside: skills emit native trace events

The skill knows when it is starting a dispatch, finishing a round, passing/failing a DoR — so it emits a structured event at each known transition. The trace schema becomes a contract the skills satisfy, not a thing a parser derives. Parser brittleness disappears.

- **Alternatives rejected.** Parse-from-outside as the primary signal source — brittle and tied to a specific transcript format. It is retained only as a best-effort fallback for reconstructing uninstrumented historical runs, with per-event confidence recorded and the post-hoc origin flagged in the report.

### Trace events are JSONL appended to the run's trace file

Events append to `projects/<slug>/trace.jsonl` for in-project work (orphan-slice / direct-change paths resolve to a scratch trace location). Visible, debuggable, no infrastructure ask; the agent does the write with existing file tools.

- **Alternatives rejected.** A custom emit-time tooling hook — lower friction at emit-time but adds infrastructure; deferred unless the file-write approach proves painful.

### The trace vocabulary and emission protocol live in a library skill

The vocabulary (`events.md`) and emission protocol (`emission.md`) live in the `drive-record-traces` library skill, and every instrumented skill references it **by name**, not by file path.

- **Why a library skill.** A per-skill copy would duplicate the common envelope, append protocol, and existence-check pattern across every instrumented skill, inviting drift. One canonical home keeps the cluster checkable against a single source.
- **Why by-name reference.** The Agent Skills model treats each skill as a self-contained, independently-installable unit with no cross-skill file-import mechanism. A hard relative path would couple an emitting skill to this skill's on-disk layout and to being installed as an adjacent sibling — neither guaranteed. By-name reference lets the runtime resolve and load the skill, keeping every skill independently installable. This is the portable form, and it is what keeps the instrumented skills free of dependencies on any one repo's project layout.

### Instrumentation never changes what a skill does

Adding "Emit" steps to a skill body must not change the work the skill performs. This is verified by spot-running an instrumented skill against a small task and confirming behaviour matches the uninstrumented baseline.

### Assertions are pruned, not accumulated

The assertion library is a memory of failures we refuse to reintroduce, not speculative coverage. A small high-signal set beats a large low-signal one. Assertions with zero fires across N consecutive instrumented runs are demoted to documentation-only or removed; adding a new assertion requires either a real observed failure or a load-bearing invariant from a Drive principle doc.

## External corroboration

The design was cross-checked against external eval-craft writing (["How to Eval AI Agents — The 2026 Guide"](https://www.howtoeval.com/), Ben Hylak), which corroborated the core shape and sharpened five anchors now folded into this model:

1. **Floor-raising frame** — composite scalars are decision-time tools at most, never the iteration headline.
2. **Golden cases** — a small library of canonical Drive briefs the harness runs against on every skill change; failing a golden case means don't ship the change (a qualitative-layer deliverable).
3. **"Asking the agent"** as an auto-retro shape — pass an instrumented trace back to the model that produced it and ask "what would you have needed to get this right?"; treat as a clue, not truth (qualitative layer).
4. **Eval-suite pruning discipline** — prune assertions with zero fires across N runs.
5. **Collapse-of-harnesses trend** — as models grow more capable, framework scaffolding collapses into the model. Implication: instrumentation must remain a contract the *skill body* satisfies, not externally-imposed scaffolding; the experiment harness should anticipate being thin (fresh agent + canonical brief + verify outputs), not elaborate.

Aligned-without-amendment: trajectory-over-final-output (covered by trace events), code-aware-over-prompt-scored (assertions read the trace), no-hosted-eval-dashboard (JSONL + per-run markdown reports), diagnose-the-pattern-not-the-incident (the intent × rounds cross-table), production-A/B-with-pinned-models (the harness layer). Considered and not adopted: self-diagnostics via an injected hidden tool (structured event emission is a better shape); volume-tiered workflow (our run volume doesn't warrant it yet).

## References

- Trace vocabulary + emission protocol: the `drive-record-traces` skill (`events.md`, `emission.md`).
- Deterministic assertions + metrics + report generator: the `drive-diagnose-run` skill.
- The methodology change this model was built to measure: [`design-decisions/2026-05-28-artifact-cascade-redesign.md`](./design-decisions/2026-05-28-artifact-cascade-redesign.md).
- Failure-mode catalogue (the rubric the qualitative F-mode classifier will use): [`../../drive/calibration/failure-modes.md`](../../drive/calibration/failure-modes.md).
