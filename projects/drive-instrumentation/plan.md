# drive-instrumentation — project plan

Three slices. Strictly stacked: 1 → 2 → 3.

## Sequencing rationale

Slice 1 lands the event-emission contract and instruments the single highest-leverage skill (`drive-build-workflow`) end-to-end. Slice 2 sweeps the rest of the `drive-*` family against the now-stable contract. Slice 3 layers the deterministic assertion + diagnostic-metrics computation on top of the trace.

The slicing is intentionally stacked rather than parallel. The trace event vocabulary in slice 1 is the contract everything else depends on; trying to parallelise slice 2 against an unstable vocab risks rework. The vocabulary stabilises in slice 1's end-to-end loop, then slice 2 fans out safely.

## Slices

### Slice 1 — Event vocabulary + `drive-build-workflow` instrumentation + emission loop end-to-end

- **Outcome.** A versioned trace-event vocabulary documented at `docs/drive/trace-events.md` (or similar; final path picked during the slice). A shared emission-protocol doc that every instrumented skill links to (where the file lives, how to append, what payload-shape rules apply). `drive-build-workflow` instrumented to emit five event types: `dispatch-start`, `dispatch-end`, `round-start`, `round-end`, `brief-issued`. Orphan-slice / direct-change trace path resolved. End-to-end demo: a `drive-build-workflow` dispatch on any in-repo task produces a `trace.jsonl` from which `rounds_per_dispatch` and `brief_write_amplification` can be computed manually (no assertion library yet).
- **Builds on.** Nothing (foundation).
- **Hands to.** Slices 2 and 3.
- **Focus.** Vocabulary design — payload schemas precise enough that downstream metric definitions can't drift. Emission-protocol authoring — terse enough that instrumented skill bodies don't bloat. Instrumentation of `drive-build-workflow` — exemplar for the sweep slice. Verification that the instrumented skill behaves identically to its uninstrumented baseline on a small in-repo task. **Out of scope:** instrumentation of other drive-* skills (slice 2 owns those); assertion library or metric module (slice 3).

### Slice 2 — Instrumentation sweep across the `drive-*` family

- **Outcome.** All in-scope drive-* skills instrumented per the slice-1 vocabulary. The full event surface (beyond the slice-1 spine of five): DoR-check / DoD-check events, artefact-write / artefact-read events, phase-transition events (specify → plan → build → review → close), escalation events, retro-fired events, operator-turn events. Each newly-instrumented skill verified against its uninstrumented baseline. Per-skill mapping table (which events each skill emits, at which step) added to the emission-protocol doc.
- **Builds on.** Slice 1's vocabulary + emission-protocol doc + the `drive-build-workflow` exemplar.
- **Hands to.** Slice 3.
- **Focus.** Instrumentation breadth — every drive-* workflow + atomic skill named in the spec's DoD. Cross-skill consistency — same event type emits the same payload shape from every emitter. Behaviour-preservation verification per skill. **Out of scope:** any metric / assertion logic that reads the trace (slice 3 owns that).

### Slice 3 — Assertion library + diagnostic metrics + report generator + post-hoc parser

- **Outcome.** Assertion library that runs invariants I1–I12 + 8 cascade-redesign rules + brief-discipline anti-patterns against an emitted trace and reports pass/fail with evidence pointers (cite the trace event that fired the violation). Diagnostic-metrics module that computes write amplification, time-to-stability, re-read count, cross-artefact contamination, phase-time distribution, first-pass acceptance rate, rounds per dispatch, backtrack ratio, tier mix, operator-turn count (raw only; classification is Project 2). Per-run report generator emits a markdown dashboard. Best-effort post-hoc transcript parser reconstructs the same trace shape from at least 3 trial-corpus runs (with per-event confidence recorded). Project DoD's final retro graded by the framework on this project's own ProjectRun.
- **Builds on.** Slice 2's fully-instrumented skill family.
- **Hands to.** Project 2 (`drive-judge-and-harness`) and (load-bearing) the operator's day-to-day skill-iteration loop.
- **Focus.** Pure trace analytics — no LLM calls. Sharp error messages on assertion failure. Honest reporting of best-effort post-hoc-parsed metrics (mark which events were inferred vs emitted natively). Self-grading retro as the close-out demo. **Out of scope:** LLM judge for correctness / F-mode / operator-turn classification (Project 2); SDK-spawned controlled-experiment harness (Project 2); cross-run aggregation dashboard (Project 2 — single-run reports are the slice-3 deliverable).

## Parallelisation

None. The vocabulary in slice 1 is the contract slices 2 and 3 read from; both depend on it landing first. Slices 2 and 3 *could* parallelise (slice 3 reads the trace shape, not the instrumentation step — so it could be written against the slice-1 exemplar's trace before slice 2 finishes), but the gain is small (slice 3 is small) and the risk is real (the vocab may need micro-amendments as slice 2 surfaces edge cases that the `drive-build-workflow` exemplar didn't). Stacked sequence is the safe pick.

## Follow-up project (out of scope here, scoped separately)

`drive-judge-and-harness` (Project 2) builds on this project's deliverables. It adds: LLM judge for the correctness rubric + F-mode classifier + operator-turn classifier (calibrated against an accreting corpus of natively-instrumented runs, not the trial corpus); single-number composite metric `expected_wallclock_to_correct_run` for ranking pairs of configs; cross-run aggregation dashboard; SDK-spawned controlled-experiment harness with replicas + model pinning + skill-version A/B; CI integration (regression gates on top-line + diagnostic metrics). Opened in Linear Backlog now so the iteration loop has its next concrete step visible.
