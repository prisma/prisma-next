# Drive — measurement model

A Drive run is judged on two axes in a fixed priority: **correctness is a gate; speed is the optimisation target.** A run that isn't correct never enters the speed comparison. Among correct runs, the faster one wins — wall-clock first, tokens second. And the output of measurement is never a single score: it is a **diagnostic dashboard** that shows *which* runs fail and *why*. The goal is floor-raising — surfacing the failures that actually hurt — not maximising a benchmark number.

A measured run produces a scorecard shaped like this:

```
Run verdict: CORRECT
  correctness   mechanical ✓   requirements ✓   intent 0.91
  wall-clock    3h 08m to merge
  tokens        1.2M   (orchestrator 38% · mid 41% · cheap 21%)

diagnostics
  rounds / dispatch      mean 1.3 · max 3        ← dispatch 04 flagged (3 rounds)
  first-pass acceptance  86%
  write amplification    1.4×
  backtracks             3 legitimate · 0 pathological
  phase mix              specify 22% · plan 14% · build 51% · review 9% · close 4%
```

Two things in that scorecard are load-bearing. First, the verdict is gated: `correctness` must pass before `wall-clock` and `tokens` mean anything. Second, the diagnostics — not the verdict — are where the value is; they tell you what to change. Any axis whose signal isn't present renders as `n/a` rather than being silently dropped, so the dashboard never implies a verdict it can't compute.

Every number above is derived from one source: a structured `trace.jsonl` that the run emits as it goes. Some numbers are computed directly from the trace (the deterministic signals); others — judging whether intent was met, classifying operator turns and failure modes — require an LLM judge over the same trace. Both read the one trace; nothing re-derives signal from raw transcripts after the fact.

## Correctness is a gate

Correctness is checked in three layers, cheapest and most objective first:

| Layer | Checks | Mechanism |
|---|---|---|
| Mechanical | typecheck, tests, lint, fixtures | Run the gates. Binary. |
| Requirements | the brief's stated outcomes hold | Per-brief acceptance set (each brief ships with its own). Binary. |
| Intent | the spirit of the brief was delivered | LLM judge with a calibrated rubric. Continuous 0–1; gate threshold 0.8. |

A run is `CORRECT` iff mechanical and requirements pass and intent ≥ 0.8. Intent stays continuous on the dashboard for trend analysis even though it is thresholded for the gate. Mechanical and requirements are computed straight from the trace and the brief's acceptance set; intent is the one correctness signal that needs the judge.

A run that fails the gate is excluded from the speed comparison entirely — a fast wrong answer is not a partial win.

## Speed is the optimisation target

Conditional on the gate, two numbers rank a run, in priority order:

1. **Wall-clock to merge** — the headline.
2. **Total tokens** — broken down by tier (orchestrator / mid / cheap).

When comparing methodology configurations across many runs, both are reported as distributions (p50, p90), not means. Variance matters as much as central tendency: a config that is fast half the time and stalls the other half is worse than a consistently mid-pace one with the same mean. Both are computed from the trace's per-event timestamps and tier-tagged token counts.

## The dashboard is the headline

The verdict tells you *whether* a run was good; the diagnostics tell you *where* it spent itself and *what to change*. Six families are always reported:

1. **Artefact churn.** Write amplification (total bytes written / final bytes), time-to-stability, re-read count, cross-artefact contamination. This is the failure mode the framework exists to surface, so it gets first-class treatment.
2. **Phase distribution.** Share of wall-clock in specify / plan / build / review / close. Front-loading design is visible here: when it works, `specify + plan` grow as a share, `build` shrinks, and the total shrinks.
3. **Dispatch rework.** First-pass acceptance rate; rounds per dispatch (p50, p90, max); high-round dispatches flagged as sharpening candidates. Each extra round costs a full validation-gate re-run plus an executor↔reviewer round-trip.
4. **Backtracks.** Legitimate (a readiness check refusing work, or a halt-and-discuss when a load-bearing assumption is falsified) versus pathological (post-execution retry, post-merge revert). The ratio is its own signal — a high legitimate share means the gates are firing in the right places.
5. **Operator turns.** Counted by kind: legitimate-design, legitimate-authorisation, illegitimate-asked, illegitimate-correction, illegitimate-rescue. The trace yields raw counts; sorting them into those buckets needs the judge.
6. **Tier mix.** Tokens consumed at the orchestrator / mid / cheap tiers. Smaller dispatches should grow the cheap-tier share.

### Pairs of metrics catch what neither catches alone

The sharpest diagnostic is a cross-table, not a single number. Intent score against rounds-per-dispatch:

| Rounds | Intent | Diagnosis |
|---|---|---|
| Low | High | One-shot success (best case). |
| High | High | Brief under-specified; got there eventually. **Sharpen the brief.** |
| High | Low | Reviewer catches problems but can't get the executor there. **Re-decompose or discuss.** |
| Low | Low | Reviewer rubber-stamping — passes the done-checks without catching drift. **The silent killer.** |

The fourth row is invisible to either metric alone; only the pair exposes it.

### What the dashboard is for

A measurement framework earns its keep by making methodology changes *falsifiable*. A change aimed at shrinking briefs, for example, predicts a concrete signature on the dashboard: write amplification trending toward ~1.0×, first-pass acceptance rising, the cheap-tier token share growing, pathological backtracks falling. Ship the change, let runs accumulate, and the dashboard confirms or refutes the prediction — the difference between measurement-driven and complaint-driven iteration. (For one such change, see the artifact-cascade redesign in [`design-decisions/`](./design-decisions/2026-05-28-artifact-cascade-redesign.md).)

## Reducing to a single number (sparingly)

Some decisions need one scalar — picking between two skill versions in a controlled A/B when the diagnostics are ambiguous. For that, and only that:

```
expected_wallclock_to_correct_run = E[wallclock | CORRECT] / P(CORRECT)
```

Lower is better; it penalises rare success in proportion to how rare it is. This composite is a tie-breaker, never the headline — its whole job is to collapse the "which 1% fails, and why" that the dashboard exists to show. Whenever the dashboard can answer the question, prefer it. (Computing the composite needs the intent gate, so it lives in the judge layer.)

## How runs are measured

### The unit is a ProjectRun, anchored on the orchestrator agent

The unit of measurement is a **ProjectRun**, identified by the orchestrator agent that drove it (its per-session transcript ID — known by construction for live runs, recoverable from the transcript store for past ones). This identifier is the only thing stable across a run's whole life, because a single run routinely spans several branches and the issue tracker is treated as informational, never as the source of truth for any boundary or metric.

A single orchestrator can interleave many ProjectRuns — projects, standalone slices, direct changes, retros, methodology work — so boundaries are delimited by two detectors: the **lifecycle-skill invocations** themselves (mechanical, primary — opening and closing a project, or a standalone slice's spec and merge), and **operator-authored markers** as a fallback when the mechanical signal is absent. Each ProjectRun records which detector delimited it, so the dashboard can flag runs delimited by weaker evidence honestly.

### Skills emit their own events

The skill is the thing that knows when it starts a dispatch, finishes a round, or passes a readiness check — so the skill emits a structured event at each such transition. This makes the trace schema a contract the skills satisfy, rather than a shape a parser tries to recover from transcript prose. Events are JSONL appended to the run's trace file with ordinary file writes — visible, debuggable, no infrastructure required.

The vocabulary of event types and the emission protocol live in one shared library skill (`drive-record-traces`), which every instrumented skill references **by name**. The Agent Skills model treats each skill as a self-contained, independently-installable unit with no mechanism for importing another skill's files; a by-name reference lets the runtime resolve the shared definitions without coupling an emitting skill to any particular on-disk layout. One shared home also keeps the common envelope and append protocol from drifting across copies. The deterministic assertions, metrics, and report generator that read the trace live in a sibling skill (`drive-diagnose-run`).

### Two invariants on instrumentation

- **Emission is behaviour-preserving.** Adding emit steps must never change what a skill does; this is verified by running an instrumented skill against the uninstrumented baseline.
- **Assertions are pruned, not accumulated.** The assertion library is a memory of failures we refuse to reintroduce, not speculative coverage. An assertion with zero fires across many consecutive runs is demoted to documentation or removed; a new one is justified only by a real observed failure or a load-bearing invariant from a principle doc.

## Alternatives considered

- **Operator-involvement minutes as the primary metric.** Rejected: a run can already proceed largely unattended, so minutes spent is a weak proxy for cost. Operator turns stay as a *diagnostic* (they catch over-asking and wrong-altitude responses), not the optimisation target.
- **A single composite score as the headline.** Rejected: it hides which runs fail and why — exactly what iteration needs. The composite survives only as a decision-time tie-breaker.
- **Anchoring a run on the issue tracker or the branch.** Rejected: tracker state is frequently stale or absent, and a run spans multiple branches. The orchestrator agent ID is the only durable anchor.
- **Delimiting runs by session boundary alone.** Rejected: a run can span several sessions, and a session can host several runs.
- **Reconstructing the trace from transcripts as the primary source.** Rejected as primary — brittle and tied to a specific transcript format. Retained only as a best-effort fallback for runs that were never instrumented, with per-event confidence recorded and the reconstructed origin flagged.
- **A custom emit-time tool/hook instead of file writes.** Rejected for now: lower friction at emit time but adds infrastructure; revisit only if plain file writes prove painful.
- **Copying the emission protocol into each skill.** Rejected: duplicates the envelope and append protocol across every skill and invites drift; one shared library skill is the single source.
- **Self-diagnostics via an injected hidden tool.** Rejected: structured event emission gives the same trajectory signal in a cleaner shape.
- **A volume-tiered eval workflow** (escalating tooling as runs/day climb). Not adopted: warranted only at run volumes well beyond what this framework operates at; revisit if that changes.

## Further reading

- Trace vocabulary and emission protocol: the `drive-record-traces` skill (`events.md`, `emission.md`).
- Deterministic assertions, metrics, and report generator: the `drive-diagnose-run` skill.
- Failure-mode catalogue (the rubric the qualitative failure-mode classifier uses): [`../../drive/calibration/failure-modes.md`](../../drive/calibration/failure-modes.md).
- A worked methodology change this model exists to measure: [`design-decisions/2026-05-28-artifact-cascade-redesign.md`](./design-decisions/2026-05-28-artifact-cascade-redesign.md).
- External background on agent eval craft: ["How to Eval AI Agents — The 2026 Guide"](https://www.howtoeval.com/) (Ben Hylak) — the source of the golden-cases and assertion-pruning ideas above.
