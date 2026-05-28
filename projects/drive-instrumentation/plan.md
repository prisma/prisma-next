# drive-instrumentation — project plan

Three slices. Strictly stacked: 1 → 2 → 3.

> **Re-specified 2026-05-28**: slice 1 expanded to cover the planning chain alongside the build loop, on the principle that planning effectiveness (spec stability, plan accuracy, I12 halt rate) is the load-bearing quality signal for the operator's workflow (delegate-from-planning-onwards). Lifecycle + direct-change gap demoted to slice 2; diagnostics + assertion stay in slice 3.

## Sequencing rationale

Slice 1 lands the event-emission contract and instruments the skills whose effectiveness the operator cares about most: the **build loop** (`drive-build-workflow`) and the **planning chain** (`drive-specify-*`, `drive-plan-*`, `drive-triage-work`, `drive-discussion`). After slice 1 ships, the operator can already compute:

- Rework rate (`rounds_per_dispatch`) — the build-loop metric.
- Brief stability (`brief-issued.brief_disposition` distribution per dispatch) — measure of whether the implementer's brief had to be reissued / amended.
- **Spec stability** (count of `spec-amended` events per project, with `reason` payloads) — the headline planning-quality signal.
- **Plan accuracy** (count of `plan-amended` events; dispatch-size distribution from `plan-authored.dispatch_size_distribution`) — whether dispatch decomposition held.
- **I12 halt rate** (count of `falsified-assumption` events per project) — the load-bearing-assumption-falsified rate, the single most damning planning-effectiveness signal.
- **Triage stability** (count of `triage-verdict` events per Linear ticket; > 1 = re-triages) — whether the verdict was right first time.

Slice 2 fills the remaining lifecycle + direct-change surfaces so the trace captures complete project shape (project / slice bookends, health-check cadence, retro firings, direct-change briefs that bypass build-workflow). Slice 3 layers the assertion + diagnostic-metric computation on top.

The slicing is intentionally stacked rather than parallel. The trace event vocabulary in slice 1 is the contract everything else depends on; trying to parallelise slice 2 against an unstable vocab risks rework. The vocabulary stabilises against the load-bearing skills in slice 1, then slice 2 extends it for lifecycle / cadence events with the contract already proven.

## Slices

### Slice 1 — Event vocabulary + build-loop + planning-chain instrumentation

- **Outcome.** A versioned trace-event vocabulary documented at `docs/drive/trace-events.md`. A shared emission-protocol doc at `docs/drive/trace-emission.md` that every instrumented skill links to. Six skill bodies instrumented per the vocabulary: `drive-build-workflow` (the build loop), `drive-specify-project`, `drive-specify-slice`, `drive-plan-project`, `drive-plan-slice`, `drive-triage-work`, `drive-discussion`. The trace captures eleven event types: the build-loop spine (`dispatch-start`, `dispatch-end`, `round-start`, `round-end`, `brief-issued`) and the planning-chain spine (`spec-authored`, `spec-amended`, `plan-authored`, `plan-amended`, `triage-verdict`, `falsified-assumption`). End-to-end demo: walkthrough on a synthetic project produces a `trace.jsonl` from which `rounds_per_dispatch`, brief stability, spec-amendment rate, plan-amendment rate, I12-halt rate, and triage-verdict distribution can be computed manually (no assertion library yet).
- **Builds on.** Nothing (foundation).
- **Hands to.** Slices 2 and 3.
- **Focus.** Vocabulary design — payload schemas precise enough that downstream metric definitions can't drift; reason-code enums (`spec-amended.reason`, `plan-amended.reason`) precise enough to distinguish substantive replans from incidental edits. Emission-protocol authoring — terse enough that instrumented skill bodies don't bloat. Instrumentation of the seven skills as exemplars for the sweep slice. Verification that each instrumented skill behaves identically to its uninstrumented baseline. **Out of scope:** instrumentation of lifecycle / cadence skills (slice 2); direct-change brief tracking via `drive-dispatch` (slice 2); assertion library or metric module (slice 3).

### Slice 2 — Lifecycle, cadence, and direct-change gap

- **Outcome.** Remaining in-scope drive-* skills instrumented per the slice-1 vocabulary, extended with the lifecycle + cadence event types. The full event surface (beyond the slice-1 eleven): project / slice lifecycle bookends, direct-change brief events from `drive-dispatch` (closing the gap where direct-change PRs currently emit nothing), setup-chain events from `drive-start-workflow`, health-check + retro firings, project-close events. Skills instrumented: `drive-deliver-workflow`, `drive-start-workflow` (setup-chain side; triage-verdict already from slice 1), `drive-dispatch`, `drive-check-health`, `drive-run-retro`, `drive-create-project`, `drive-close-project`. Per-skill mapping table (which events each skill emits, at which step) added to the emission-protocol doc.
- **Builds on.** Slice 1's vocabulary + emission-protocol doc + the seven slice-1 exemplars.
- **Hands to.** Slice 3.
- **Focus.** Closing the trace's blind spots — direct-change work currently invisible; lifecycle events currently inferable only from cross-event reasoning; cadence events (health-check / retro) currently silent. Cross-skill consistency — same event type emits the same payload shape from every emitter. Behaviour-preservation verification per skill. **Out of scope:** any metric / assertion logic that reads the trace (slice 3 owns that); QA-side skills (`drive-pr-description`, `drive-pr-walkthrough`, `drive-qa-plan`, `drive-qa-run`, `drive-code-review`) — these are PR-authoring / QA-artifact skills at the edges of the workflow and don't need trace events to assess methodology effectiveness; revisit in close-out if signal demands it.

### Slice 3 — Assertion library + diagnostic metrics + report generator + post-hoc parser

- **Outcome.** Assertion library that runs invariants I1–I12 + 8 cascade-redesign rules + brief-discipline anti-patterns against an emitted trace and reports pass/fail with evidence pointers (cite the trace event that fired the violation). Diagnostic-metrics module that computes: rework rate, spec stability, plan accuracy, I12 halt rate, triage stability, write amplification, time-to-stability, re-read count, cross-artefact contamination, phase-time distribution, first-pass acceptance rate, rounds per dispatch, backtrack ratio, tier mix, operator-turn count (raw only; classification is Project 2). Per-run report generator emits a markdown dashboard. Best-effort post-hoc transcript parser reconstructs the same trace shape from at least 3 trial-corpus runs (with per-event confidence recorded). Project DoD's final retro graded by the framework on this project's own ProjectRun.
- **Builds on.** Slice 2's fully-instrumented skill family.
- **Hands to.** Project 2 (`drive-judge-and-harness`) and (load-bearing) the operator's day-to-day skill-iteration loop.
- **Focus.** Pure trace analytics — no LLM calls. Sharp error messages on assertion failure. Honest reporting of best-effort post-hoc-parsed metrics (mark which events were inferred vs emitted natively). Self-grading retro as the close-out demo. **Out of scope:** LLM judge for correctness / F-mode / operator-turn classification (Project 2); SDK-spawned controlled-experiment harness (Project 2); cross-run aggregation dashboard (Project 2 — single-run reports are the slice-3 deliverable).

## Parallelisation

None. The vocabulary in slice 1 is the contract slices 2 and 3 read from; both depend on it landing first. Slice 2 *could* race slice 3 (slice 3 reads the trace shape, not the instrumentation step — so it could be written against slice 1's traces before slice 2 finishes), but the gain is small (slice 3 is small) and the risk is real (the vocab may need micro-amendments as slice 2 surfaces lifecycle edge cases). Stacked sequence is the safe pick.

## Follow-up project (out of scope here, scoped separately)

`drive-judge-and-harness` (Project 2) builds on this project's deliverables. It adds: LLM judge for the correctness rubric + F-mode classifier + operator-turn classifier (calibrated against an accreting corpus of natively-instrumented runs, not the trial corpus); single-number composite metric `expected_wallclock_to_correct_run` for ranking pairs of configs; cross-run aggregation dashboard; SDK-spawned controlled-experiment harness with replicas + model pinning + skill-version A/B; CI integration (regression gates on top-line + diagnostic metrics). Opened in Linear Backlog ([TML-2705](https://linear.app/prisma-company/issue/TML-2705)) so the iteration loop has its next concrete step visible.
