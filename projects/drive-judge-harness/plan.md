# Drive — Judge + live-experiment harness — Plan

**Spec:** `projects/drive-judge-harness/spec.md`
**Linear Project:** [Drive — Judge + live-experiment harness](https://linear.app/prisma-company/project/drive-judge-live-experiment-harness-efa7d807c716)

## At a glance

Four slices in a mostly-stacked shape: two foundation slices that can run in parallel (the honest scorecard + trace inputs, and the golden-case harness), then the judge (which needs both), then the operator-facing experiment engine (which needs the judge). The corpus-gating constraint — judge calibration needs ~10–20 instrumented runs — is what forces the harness ahead of the judge.

## Composition

### Stack (deliver in dependency order)

The two foundation slices (1 and 2) have no dependency on each other and form **Parallel group F** below; slices 3 and 4 stack on top of them.

3. **Slice `llm-judge`** — Linear: `TML-2736`
   - **Outcome:** the Tier-1 correctness signal becomes _computable_ — a calibrated judge scores mechanical/requirements/intent correctness, classifies failure modes (F1–F9 + scope traps), and classifies operator turns; auto-retro surfaces evidence-supported clues in `drive-run-retro`.
   - **Builds on:** Slice 1's external-correctness feed slot + Slice 2's instrumented-run corpus (≥10–20 runs to calibrate against).
   - **Hands to:** a calibrated Tier-1 correctness signal the scorecard and the experiment engine consume.
   - **Focus:** judge prompt sets + calibration to ≥80% held-out agreement, cross-family judge model. Not the A/B engine, not the dashboard.

4. **Slice `experiment-engine`** — Linear: `TML-2737`
   - **Outcome:** the operator can A/B two skill versions and read deltas; CI catches a regression in a sandbox experiment.
   - **Builds on:** Slice 3's calibrated judge + Slice 2's run-spawning/corpus + Slice 1's scorecard shape + token signal.
   - **Hands to:** project close-out — reproducible A/B reports + a working CI regression gate.
   - **Focus:** SDK k=N A/B with model pinning, cross-run aggregation dashboard, composite ranker `E[wallclock|CORRECT]/P(CORRECT)` (decision-time tool, not headline), CI regression gate. **Largest slice — flagged for split at pickup** (see Sequencing rationale).

### Parallel group F (foundation — independent of each other; both precede the stack)

- **Slice `scorecard-and-trace-inputs`** — Linear: `TML-2720`
  - **Outcome:** the diagnostics report stops implying "good" — it prints a two-tier scorecard with an honest `not computable` verdict whenever the correctness signal is absent; and the trace vocabulary gains the inputs the scorecard needs (a token-usage signal, an external-correctness feed).
  - **Builds on:** None (Project 1 trace contract + emitter, both landed).
  - **Hands to:** the scorecard shape + token/correctness vocabulary the judge populates (Tier-1 feed) and the experiment engine reads.
  - **Focus:** diagnostics-side verdict synthesis + schema-side vocabulary additions. Not the judge that fills the correctness feed (slice 3).

- **Slice `golden-case-harness`** — Linear: `TML-2735`
  - **Outcome:** a usable artefact that produces natively-instrumented runs on demand — 5–10 canonical Drive briefs with acceptance sets + minimal SDK wiring to run one brief end-to-end; the post-hoc parser is validated against the ≥3 runs it produces (clears TML-2728).
  - **Builds on:** None (deterministic emitter landed).
  - **Hands to:** the run-spawning mechanism the experiment engine builds on + the accreting corpus the judge calibrates against.
  - **Focus:** brief curation + run-one-brief wiring + parser validation. Not the k=N A/B engine (slice 4).

## Dependencies (external)

- [x] **drive-instrumentation Project 1** — closed; trace contract durable under `docs/drive/` and `skills-contrib/drive-record-traces/`.
- [x] **Deterministic, fail-closed emitter (TML-2721)** — merged (PR #633); skill-emitted traces are trustworthy at the line level.
- [ ] **Cursor SDK (`@cursor/sdk`)** — needed by slices 2 and 4 to spawn pinned-model runs. Status: available; integration unverified in this repo (slice 2 confirms).
- [ ] **Instrumented-run corpus (~10–20 runs)** — produced by slice 2; gates slice 3 calibration. Status: 1 run accreting (this project's own trace).

## Sequencing rationale

- **Why the harness precedes the judge.** Judge calibration is corpus-gated (≥10–20 instrumented runs). The golden-case harness is the corpus generator, so it must land — and run — before the judge slice's calibration step. The judge slice can begin prompt-set authoring against the accreting corpus, but cannot _close_ until calibration clears.
- **Why slices 1 and 2 are parallel.** Neither foundation slice depends on the other: the scorecard/vocabulary work is diagnostics- and schema-side; the harness work is SDK- and brief-side. The token/correctness vocabulary (slice 1) makes harness-spawned runs _richer_, but the corpus is useful for judge calibration without it, so we don't serialise them.
- **Slice 4 size flag.** Slice 4 combines the original project-sketch's slice 3 (cross-run aggregation + auto-retro + dashboard) and slice 4 (SDK A/B harness + CI gate). It is the one slice at risk of failing slice-INVEST *Small*. Decision: keep it whole in the project plan; let `drive-plan-slice` split it into `aggregation-dashboard` and `experiment-harness` at pickup if one reviewer can't hold it in a single sitting. Splitting now would pre-commit to a boundary we can draw more accurately once slices 1–3 have landed.
- **Project-boundary check (4 slices, top of the 1–4 band).** Per `drive-plan-project`, 5+ slices flags "two projects in a trenchcoat." This plan holds at 4 by combining aggregation + A/B into slice 4. The judge and the harness stay in one project because the harness exists to _feed_ the judge a corpus and the A/B engine exists to _consume_ the judge's signal — the refinement loop is the project. This is recorded as Open Question 1 in the spec; revisit if slice 4 splits and the count goes to 5.

## Close-out (required)

- [ ] Verify all acceptance criteria in `projects/drive-judge-harness/spec.md`.
- [ ] Migrate long-lived docs into `docs/` (judge rubric / harness usage → `docs/drive/`; any architectural decision → ADR).
- [ ] Strip repo-wide references to `projects/drive-judge-harness/**`.
- [ ] Delete `projects/drive-judge-harness/`.
- [ ] Mandatory final retro (invariant I10).
