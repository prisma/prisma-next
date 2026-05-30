# Design notes: Drive — Judge + live-experiment harness

> Synthesized design document. Read this to understand **what the design is**, **what principles it serves**, and **what alternatives were rejected**. It captures the settled design, not a chronological log.
>
> Owned by the Orchestrator; authored directly. Cross-linked from [`./spec.md`](./spec.md).

## Principles this design serves

- **Correctness-first.** Speed and token savings never compensate for incorrect work; correctness is a hard gate, not a weighted term.
- **Floor-raising, not benchmark-maxxing.** The diagnostic dashboard is the iteration headline; the composite scalar is a sparingly-used decision-time ranker. The goal is making the drive-\* skills reliably better, not maximising a leaderboard number.
- **Trust the instrument before trusting the number.** A judge's output is used as a correctness signal only after it agrees with human grading ≥80% on held-out data.
- **Measurement honesty.** The report must admit when it cannot answer "was this good?" rather than letting all-green metrics imply it.
- **Cross-family grading.** The judge model is from a different family than the orchestrator under test, to avoid same-family grading bias.

## The model

### Two-tier scorecard

The headline of every run report is a scorecard with a strict tier order:

- **Tier 1 — correctness gate (binary, external, composed).** Sourced from _outside_ the run. For sandboxed golden-case runs (no CI without an isolated fork), `CORRECT` = validation gates pass (`pnpm typecheck` / `test` / `lint`) **AND** a successful QA run (each golden case ships a pre-written `drive-qa-plan` in its acceptance set) **AND** the judge's intent/requirements verdict passes. Merge status / CI is an optional stronger signal only for real-PR runs against an isolated fork. A run is `CORRECT` or not. This is the #1 axis.
- **Tier 2 — efficiency, scored only over `CORRECT` runs.** Tokens-to-correct, wall-clock-to-correct, rework (rounds-per-dispatch). Scoring an incorrect run's efficiency is meaningless, so Tier 2 is gated on Tier 1.

When the Tier-1 input is absent, the verdict line reads `not computable` and names the missing input. This is the correct shippable state until the judge exists — not a stub.

### The composite ranker

`E[wallclock | CORRECT] / P(CORRECT)` — expected wall-clock to _a correct run_, inflated by the failure rate. It is a single number used **only** when diagnostics are ambiguous and the operator needs a tiebreak ranking between two skill versions. It is never the dashboard headline; surfacing it as the headline is the failure mode this design guards against.

### The judge

Three prompt sets, judge model cross-family from the orchestrator under test (hard requirement; default **GPT 5.5**, cross-family from today's Claude orchestrator; a pinned per-experiment parameter): (a) correctness rubric (mechanical / requirements / intent); (b) failure-mode classifier (F1–F9 + scope traps + QA coverage-gate gaps); (c) operator-turn classifier (five buckets distinguishing legitimate design/authz turns from illegitimate correction/rescue turns). Calibrated against an accreting corpus to ≥80% held-out agreement before its output feeds Tier 1.

### The harness

Golden-case library (5–10 canonical briefs with co-located acceptance sets) + SDK-spawned runs with pinned models. Produces the instrumented-run corpus the judge calibrates against, and grows into the k=N A/B engine that compares two skill versions and gates CI on regressions.

### Corpus-gating

The single hardest sequencing constraint: judge calibration needs ~10–20 instrumented runs, which only exist once the harness runs the golden cases. This forces harness-before-judge and is why the honest `not computable` scorecard must ship first.

## Alternatives considered

- **Single composite scalar as the dashboard headline.** Attractive: one number ranks everything. **Rejected because:** it hides the correctness/efficiency trade-off and invites benchmark-maxxing — the operator stops reading diagnostics and starts gaming the scalar.
- **Trust the self-asserted `round-end.verdict: satisfied` as the correctness signal.** Attractive: already in the trace, free. **Rejected because:** it is the emitter's _claim_, not ground truth — a skill can hand-emit `satisfied` on a failed round. Establishing real correctness is the entire reason the judge exists; the deterministic emitter removed formatting freedom, not semantic freedom.
- **Same-family judge (model grades its own family).** Attractive: cheaper, simpler. **Rejected because:** same-family grading bias inflates agreement without measuring real correctness.
- **A large speculative golden-case corpus (hundreds of briefs).** Attractive: coverage. **Rejected because:** floor-raising needs a handful of high-signal cases; 200 speculative ones cost more to maintain than they signal, and dilute the regression gate.
- **Wall-clock alone as the efficiency metric.** **Rejected because:** wall-clock is a weak proxy; tokens are the stated #1 optimization target after correctness and must be instrumented directly.
- **Adopting an industrial-grade eval framework (Inspect / Braintrust / promptfoo / LangSmith) as the substrate.** Attractive: dataset management, judge scoring, experiment-diff dashboards out of the box. **Rejected as the default because:** they assume the unit-under-test is a single model call or RAG pipeline, not a multi-hour SDK-spawned agent run scored from heterogeneous signals — and standing one up is itself non-trivial machinery. The default is a minimal bespoke scorer; a framework is adopted only if a time-boxed slice-3 spike shows it reduces _net_ complexity. The run-production harness stays bespoke regardless (it's Cursor-SDK-specific; nothing off-the-shelf spawns and grades it).
- **Split into two projects (judge / harness).** Attractive: each lands at ≤3 slices, cleaner boundaries. **Rejected (for now) because:** the harness exists to _feed_ the judge a corpus and the A/B engine exists to _consume_ the judge's signal — splitting severs the refinement loop across two trackers. Revisit if slice 4 splits and the count crosses 4 (spec Open Question 1).

## Open questions

None remaining — all resolved during shaping (see spec § Decisions). For the record:

- **One project, not two** — the feed→consume loop is the project; revisit only on a slice-4 split.
- **Judge model** — cross-family hard requirement; default GPT 5.5; pinned per experiment.
- **Token signal** — per-run `tokens` from the SDK's `TurnEndedUpdate.usage`; hand-runs `null`.
- **Correctness gate** — composed (validation gates + QA run + judge intent) for sandboxed runs; merge/CI optional, real-PR-only.
- **Baseline** — previous skill version on the same golden case(s).
- **Scorer** — bespoke-minimal by default; slice-3 spike gates any framework adoption on a net-complexity win.

## References

- Project spec: [`./spec.md`](./spec.md)
- Project plan: [`./plan.md`](./plan.md)
- Predecessor methodology: [`docs/drive/`](../../docs/drive/README.md)
- Trace contract: [`skills-contrib/drive-record-traces/`](../../skills-contrib/drive-record-traces/)
- Self-grade trust caveat: [`drive/retro/findings.md`](../../drive/retro/findings.md)
