# drive-instrumentation — project spec

## Purpose

Instrument the `drive-*` skill family with native trace emission so that every Drive run produces a structured `trace.jsonl` from which deterministic invariant assertions and diagnostic metrics can be computed. The instrumented skills + the deterministic measurement framework are the product. The first iteration loop the framework enables is the one the operator will use immediately: change a drive-* skill, run it, read the diagnostic deltas straight off the trace, tune.

**Framing — floor-raising, not benchmark-maxxing.** The framework exists to make the drive-* skills reliable where reliability matters, by surfacing the failure patterns that actually hurt (artefact churn, dispatch rework, pathological backtracks, operator rescues). The headline is the diagnostic dashboard — *which 1% fails, and why*. Composite scalars for ranking pairs of methodology configs live in Project 2 as a decision-time tool only, never as the iteration headline.

The underlying motivation: the 2026-05-28 artifact-cascade redesign of the Drive methodology was qualitatively-driven (specs and plans too wordy, briefs too long, dispatches too slow, tokens burned re-reading and re-writing artefacts). The operator wants to iterate on the drive-* skills with measurement-driven feedback instead of complaint-driven feedback. Instrumented traces + deterministic diagnostics are the foundation that makes that loop possible.

## Non-goals

- Not building the LLM judge for the correctness rubric, F-mode classifier, or operator-turn classifier. That is the follow-up project (`drive-judge-and-harness`).
- Not building the SDK-spawned controlled-experiment runner (also follow-up).
- Not grading the trial corpus as a primary deliverable. Best-effort post-hoc trace reconstruction is in scope as a fallback; producing the grade is not.
- Not aiming for full event coverage in slice 1. The minimum event spine ships first; sweep across the rest of the skill family is slice 2.
- Not changing the canonical Drive workflow shape. Instrumentation augments the skills' instructions; it does not change what the skills do.

## Place in the larger world

- **Consumes:** the `drive-*` skill bodies under `skills-contrib/`; the Drive principle docs (the rubric source); historical Cursor agent transcripts under `~/.cursor/projects/<workspace>/agent-transcripts/` (for the best-effort post-hoc parser).
- **Produces:** a versioned trace-event vocabulary; instrumentation patches across the `drive-*` skill family; an assertion library; a diagnostic-metrics module; a per-run report generator; a post-hoc transcript parser that emits the same trace shape on best-effort basis.
- **Integrates with:** the canonical drive-* skill bodies (which gain "Emit" steps at known transition points referencing a shared emission protocol doc).
- **Hands to:** the follow-up project `drive-judge-and-harness` (which builds the LLM judge for correctness/F-mode/operator-turn on top of the trace + adds the SDK-spawned A/B harness, calibrated against an accreting corpus of instrumented runs).

## ProjectRun — the unit of measurement

A `ProjectRun` is the unit of measurement. Anchored on the orchestrator-agent ID (Cursor's per-session transcript UUID; obtained from the SDK or filesystem for live runs; extracted from `~/.cursor/projects/<workspace>/agent-transcripts/<uuid>/` for retrospective). Within a single orchestrator's lifetime, ProjectRun boundaries are delimited by two complementary detectors:

- **Drive-skill boundary** — primary. `drive-create-project` invocation opens a project ProjectRun; `drive-close-project` closes it. `drive-specify-slice` opens an orphan-slice ProjectRun; merge of the slice's PR closes it. Mechanical, no special marker needed.
- **Operator-marker** — fallback. Operator-authored markers ("Starting project X", "Closing out project X") detected by the parser when the drive-skill-boundary signal is absent or weak.

Each ProjectRun records `detection_method: "drive-skill-boundary" | "operator-marker" | "session-boundary-fallback"` so the diagnostic report flags runs delimited by weaker evidence honestly.

Linear is informational only — issue/project status changes annotate the trace report but are never the source of truth for ProjectRun boundaries or for any computed metric.

## Cross-cutting requirements

- **Trace schema is a contract the skills satisfy.** Skills emit events at well-defined transition points. The schema is the source of truth for what an event is. No metric reads raw transcripts at metric-time.
- **Emission is JSONL.** Trace events append to `projects/<slug>/trace.jsonl` for in-project work. Orphan-slice / direct-change emission path is resolved in slice 1 (placeholder: `wip/drive-trace/<run-id>.jsonl`).
- **Emission instructions are factored.** Each instrumented skill gains a terse "Emit" step at each transition point, linking to a shared emission-protocol doc rather than restating the protocol inline. Keeps instrumentation footprint on skill bodies small.
- **Post-hoc parser is best-effort, not load-bearing.** The trial corpus runs uninstrumented; the parser reconstructs as many events as it can from transcript text + git + filesystem evidence. Per-event confidence is recorded; some event types will be missing or weakly inferred for uninstrumented runs. The report names this honestly.
- **No skill instrumentation may regress the skill's own behaviour.** Adding "Emit" steps must not change what work the skill does. Verified by spot-running an instrumented skill against a small in-repo task and confirming the behaviour matches the uninstrumented baseline.
- **Assertion library is pruned, not accumulated.** Assertions are a memory of failures we refuse to reintroduce, not speculative coverage. A small high-signal set beats a large low-signal one. Review cadence: at every Drive-methodology retro, and at minimum at every Project DoD self-grading, the assertion library is reviewed against fire-rate evidence. Assertions with zero fires across N consecutive instrumented runs (N TBD in slice 3, anchored to actual run volume) are demoted to documentation-only or removed. Adding a new assertion requires either a real observed failure or a load-bearing invariant from a Drive principle doc; speculative "for coverage" assertions are refused.

## Transitional-shape constraints

- **Each slice leaves a usable artefact.** Slice 1 (event vocab + `drive-build-workflow` instrumentation + minimal assertions) is usable standalone: the operator can rev `drive-build-workflow`, run it, and read `rounds_per_dispatch` + `brief_write_amplification` straight off the trace. Slice 2 (instrumentation sweep) is usable standalone for full-coverage deterministic metrics. Slice 3 (full assertion library + diagnostic dashboard) is the close-out.
- **No slice breaks the Drive skills under test.** Each instrumented skill is verified against an uninstrumented baseline before the slice closes.
- **The framework grades itself.** Project closes with a retro graded by its own framework on its own ProjectRun, dogfooding the loop the project is built to enable.

## Project Definition of Done

Inherits the team-DoD floor at [`drive/calibration/dod.md`](../../drive/calibration/dod.md). Project-specific additions on top:

- [ ] Trace event vocabulary documented and versioned. Each event type names its emitting skill(s), its trigger condition, its payload schema, and the metrics that read it.
- [ ] Shared emission-protocol doc lives under `docs/drive/` and is referenced from every instrumented skill body.
- [ ] All `drive-*` workflow + atomic skills (workflow: `drive-start-workflow`, `drive-build-workflow`, `drive-deliver-workflow`; atomic: `drive-create-project`, `drive-specify-project`, `drive-specify-slice`, `drive-plan-project`, `drive-plan-slice`, `drive-run-retro`, `drive-close-project`, `drive-triage-work`) instrumented per the vocabulary.
- [ ] Assertion library covers the 12 invariants (I1–I12) + 8 cascade-redesign rules + brief-discipline anti-patterns, read from the emitted trace. Coverage gaps explicitly named with rationale.
- [ ] Diagnostic metrics compute from the trace: write amplification, time-to-stability, re-read count, cross-artefact contamination, phase-time distribution, first-pass acceptance rate, rounds per dispatch, legitimate-vs-pathological backtrack ratio, tier mix, operator-turn count (raw — classification is Project 2's judge).
- [ ] Per-run report generator emits the deterministic dashboard (no LLM judge sections in this project).
- [ ] Post-hoc transcript parser reconstructs the trace on best-effort basis from at least 3 trial-corpus runs; confidence is recorded per event; the report flags the post-hoc origin.
- [ ] Project's own final retro is graded by the framework against its own ProjectRun and produces ≥1 canonical / project-context / ADR update.
- [ ] Long-lived methodology surfaces (trace event vocab spec, emission-protocol doc, metric definitions) migrated to `docs/` per the close-out destination rules; transient project artefacts deleted.
