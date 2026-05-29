# drive-instrumentation — design notes

This file captures the reasoning behind the project's current shape. Two halves:

- **Part A — the metric design.** The measurement hierarchy (correctness gate → speed → diagnostics) the operator and agent settled on before this project was sliced. Still load-bearing for Project 2 (`drive-judge-and-harness`); kept here because Project 1's diagnostic-metrics module computes the deterministic subset, and Project 2's judge slots in alongside.
- **Part B — the 2026-05-28 discussion-mode synthesis.** The architect + pm + architect cross-pollination that reshaped this project from "retrospective grading first" to "instrumentation first," settled the trace anchoring decisions, and split the work into two projects at the instrumentation-vs-judge seam.

---

## Part A — metric design (durable)

### Correctness is a gate; speed is the optimisation target

The first framing attempted treated operator-involvement minutes as the primary metric. That was wrong. The operator already lets Drive runs proceed independently — the problem is they run for *days*, burn tokens re-reading and re-writing artefacts, and the speed of arriving at a correct result matters more than minimising operator turns. Operator-time stays as a diagnostic (it catches F6 over-asking and F7 wrong-altitude responses), but the headline shape is:

- **Correctness** is a gate. A run that fails correctness doesn't enter the speed comparison.
- **Speed** (wall-clock primary, tokens secondary) is the optimisation target *conditional on* the gate.

This matches how SWE-bench and most agent benchmarks worth copying are structured. Single-axis metrics hide where the failure modes live.

### Correctness has three layers

| Layer | Checks | Mechanism |
|---|---|---|
| Mechanical | typecheck, tests, lint, fixtures | Run the gates. Binary. |
| Requirements | The brief's stated outcomes hold | Per-brief acceptance set (each brief in the library ships with its own). Binary. |
| Intent | The spirit of the brief was delivered | LLM judge with calibrated rubric. Continuous 0–1; threshold at 0.8 for the gate. |

A run is `CORRECT` iff mechanical + requirements pass and intent ≥ 0.8. Intent stays continuous in the dashboard for trend analysis even though it's thresholded for the gate.

**Project-1 scope.** Mechanical + Requirements (deterministic — read from the emitted trace + the brief's acceptance set). Intent is Project 2's LLM judge.

### Speed has two numbers, in priority order

1. Wall-clock to merge — the headline.
2. Total tokens (broken down by tier: orchestrator / mid / cheap).

Both reported as distributions (p50, p90), not means. Variance matters as much as central tendency for methodology comparison — a config that's fast 50% of the time and stalls 50% of the time is worse than a consistently mid-pace one even with the same mean.

**Project-1 scope.** Both — deterministically computable from the emitted trace's per-event timestamps + tier-tagged token counts.

### Composite for ranking — decision-time only, never the headline

When ranking two configs requires one scalar:

```
expected_wallclock_to_correct_run = E[wallclock | CORRECT] / P(CORRECT)
```

Lower is better. Penalises rare success proportionally to how rare it is. Standard ML-ops shape.

**The composite is a benchmark-maxxer tool used sparingly at decision time** — e.g. when picking between two candidate skill versions in a controlled A/B and the diagnostics are ambiguous. It is **never** the iteration headline. The piece that crystallised this framing puts the litmus test as "if 1% fails, which 1%?" — the diagnostic dashboard answers that; the composite hides it. The framework's headline is always the tuple `(P(CORRECT), wallclock_p50, wallclock_p90, tokens_p50)` + the diagnostic decomposition.

**Project-1 scope.** Out — the composite requires the Intent gate (Project 2). Project 1 reports per-run deterministic dashboards; cross-run aggregation + composite is Project 2, and even there it is the secondary ranking tool, not the dashboard headline.

### Diagnostics

Six diagnostic families, always reported alongside the headline:

1. **Artefact churn.** Write amplification (total bytes written / final bytes), time-to-stability, re-read count, cross-artefact contamination. The operator named this failure mode explicitly; it gets first-class treatment. The cascade-redesign hypothesises briefs drop from 200+ lines with rewrites to ~30 lines one-shot — this is the metric that falsifies that.
2. **Phase distribution.** % of wall-clock in specify / plan / build / review / close. The "front-load design" hypothesis is observable here: if it's working, `specify + plan` grow as share, `build` shrinks, total shrinks.
3. **Dispatch rework.** First-pass acceptance rate; rounds per dispatch (p50, p90, max); high-round slices flagged as sharpening candidates. Each round costs a full validation-gate re-run + executor↔reviewer message round-trip.
4. **Backtracks.** Legitimate (DoR refusals + I12 halt-and-route-to-discussion) vs pathological (post-execution retry + post-merge revert). Ratio is its own diagnostic — high ratio means gates fire in the right places.
5. **Operator turns.** Five buckets (legitimate-design / legitimate-authz / illegitimate-asked / illegitimate-correction / illegitimate-rescue). **Project 1 reports raw counts only**; classification into buckets is Project 2's judge.
6. **Tier mix.** Tokens consumed at orchestrator / mid / cheap. The cascade-redesign predicts cheap-tier share grows materially.

### Interactions between metrics matter

The intent score × rounds-per-dispatch cross-table is diagnostic in a way neither metric is on its own:

| Rounds | Intent | Diagnosis |
|---|---|---|
| Low | High | One-shot success (best case) |
| High | High | Brief under-specified; eventually right. **Sharpen the brief.** |
| High | Low | Reviewer catching problems but can't get executor there. **Re-decompose / discuss.** |
| Low | Low | Reviewer rubber-stamping. **Worst case — passes DoD without catching drift.** |

The fourth row is the silent killer; tracking both metrics catches it. The cross-table reads from Project 1's `rounds_per_dispatch` (deterministic) + Project 2's intent judge — both must land to make the diagnosis legible.

### Falsification predictions for the cascade-redesign

The cascade-redesign of 2026-05-28 was a major methodology shift made without instrumentation. Six predicted shifts the instrumented framework will falsify-or-confirm once enough instrumented runs accumulate:

1. Brief write-amplification drops to ~1.0× (was higher when briefs were 200+ lines with rewrites).
2. Project-spec stability — stable within < 2h of first creation (vs mutating throughout the project).
3. Phase mix — `specify + plan` share grows; `build` share shrinks; total shrinks.
4. Tier mix — cheap-tier token share grows materially.
5. Pathological backtrack rate drops.
6. First-pass dispatch acceptance rate rises.

This is now an outcome of the iteration loop the project enables, not a deliverable of the project itself.

---

## Part B — 2026-05-28 discussion-mode synthesis (the reshape)

The project entered as `drive-eval-retrospective` — a retrospective grading framework focused on grading the 2026-05-19 → 2026-06-02 trial corpus to feed TML-2567 synthesis by 2026-06-02. A `drive-discussion` session that started with the architect lens, cross-pollinated to the pm lens, and ended back in the architect lens reshaped the project at three load-bearing seams.

### Refined topic

From: "retrospective grading framework to feed TML-2567 synthesis on 2026-06-02, then maybe a live loop afterwards."

To: **"instrument the drive-* skills with native trace emission so the iteration loop (change skill → run → measure → tune) is the product, with retrospective grading demoted to best-effort post-hoc."**

### Decisions

#### D1. `ProjectRun` is the unit of measurement, anchored on the orchestrator-agent ID; Linear is informational only.

- **Why.** Linear is frequently stale or absent; branch-anchoring breaks because a project typically spans multiple branches (one per slice). The orchestrator-agent ID is the only stable identifier across the life of a run.
- **Assumes.** The orchestrator-ID is reliably knowable. Live runs: known by construction (via SDK on launch). Retrospective: extractable from `~/.cursor/projects/<workspace>/agent-transcripts/<uuid>/`.
- **Alternatives rejected.** Linear-anchored (treated as informational, not load-bearing); branch-anchored (multi-branch projects break it).

#### D2. ProjectRun boundaries delimited by (β) operator-marker + (γ) drive-skill-boundary, with detection method exposed in the report.

- **Why.** A single orchestrator can host many ProjectRuns interleaved (projects + orphan slices + direct changes + retros + methodology refactoring). The schema needs a delimiter. The cleanest signal is the drive-* skill invocations themselves (mechanical); operator-tagged markers cover gaps when (γ) doesn't fire.
- **Detection.** Primary — `drive-create-project` invocation opens a project ProjectRun; `drive-close-project` closes it. `drive-specify-slice` opens an orphan-slice ProjectRun; merge of the slice's PR closes it. Fallback — operator-authored markers ("Starting project X", "Closing out project X") detected by the parser when (γ) is absent.
- **Each ProjectRun records `detection_method: "drive-skill-boundary" | "operator-marker" | "session-boundary-fallback"`** so the report names runs delimited by weaker evidence honestly.
- **Assumes.** Future runs follow the drive-* workflow skills. Pre-Drive-skill corpus runs are best-effort.
- **Alternatives rejected.** `/new` session boundary alone (multi-session projects break it).

#### D3. Future-first priority; retrospective grading is the first stress test, not the primary deliverable.

- **Why.** Operator wants to iterate on the drive-* skills with measurement-driven feedback. The trial-synthesis deadline (TML-2567 / 2026-06-02) was the agent's framing, not a real constraint.
- **Assumes.** The trial corpus is still useful as a calibration substrate (best-effort post-hoc trace reconstruction), but not as ground truth.
- **Alternatives rejected.** "Ship retrospective grade by 2026-06-02" — falsified as a real deadline by the operator.

#### D4. Observation-from-inside: instrument the drive-* skills with native trace emission, not transcript-parser-from-outside.

- **Why.** The skill knows when it's starting a dispatch, finishing a round, passing/failing a DoR — emit a structured event at known transitions. Trace schema becomes a contract the skills satisfy, not a thing the parser derives. Parser-brittleness disappears.
- **Assumes.** The skill bodies can carry "Emit" steps without bloating instructions to the point of harm. Mitigation: factor a shared emission-protocol doc that skills link to; each skill body lists only its own event types and payload shape.
- **Alternatives rejected.** Parse-from-outside as primary signal source (brittle and tied to Cursor transcript format). Retained as best-effort fallback for the trial corpus only.

#### D5. Trace events are JSONL appended to `projects/<slug>/trace.jsonl` (orphan-slice / direct-change path resolved in S1).

- **Why.** Visible, debuggable, no infra ask; agent does the write with existing file tools.
- **Alternatives rejected.** Custom Cursor hook tool — lower friction at emit-time but adds infrastructure. Deferred until v2 if the file-write approach turns out to be load-bearing-painful.

#### D6. S1 minimum event spine: `dispatch-start`, `dispatch-end`, `round-start`, `round-end`, `brief-issued`, instrumented in `drive-build-workflow` first.

- **Why.** Enough to compute `rounds_per_dispatch` and `brief_write_amplification` end-to-end (the two metrics the operator named earliest as load-bearing for catching artefact churn + rework). Proves the loop on the highest-leverage skill before sweeping the rest.

#### D7. Project splits at the instrumentation-vs-judge seam.

- **Project 1** = `drive-instrumentation`: event vocab + skill-emission patches + assertions + diagnostic metrics. **3 slices** (down from the original 4).
- **Project 2** = `drive-judge-and-harness`: LLM judge (correctness/F-mode/operator-turn) + dashboard + SDK-spawned A/B harness. **Opened in Linear Backlog immediately**, not after Project 1 closes — the iteration loop the operator wants has the next concrete step visible.
- **Why.** Project 1 alone delivers a usable iteration loop (skill change → emit trace → check assertions/diagnostics on a deterministic-only basis). Project 2 layers the qualitative grading + automated A/B on top.
- **Assumes.** Calibration-corpus accretion happens naturally as Project 1's instrumented runs accumulate; Project 2's judge calibrates against that corpus rather than the trial corpus.

#### D8. Slice 1 expanded to cover the planning chain alongside the build loop (2026-05-28).

- **Why.** Slice 1's original scope (D6 — five-event spine in `drive-build-workflow`) measures build-loop rework but is silent on planning effectiveness. The operator's workflow is delegate-from-planning-onwards: the operator participates in design discussion, then the agent authors specs + plans + executes; the operator does NOT read specs or plans. In that workflow, the load-bearing quality surfaces are spec stability, plan accuracy, I12 halt rate, and triage stability — none of which fall out of build-loop instrumentation alone. A slice that ships only build-loop events can't compute the metrics that matter most for the operator's day-to-day. The PR (TML-2704) is also one nobody would consume as-shipped — every metric that flows from slice 1 requires the planning chain to be instrumented before it becomes useful for skill iteration.
- **Decision.** Expand slice 1 to also instrument `drive-specify-project`, `drive-specify-slice`, `drive-plan-project`, `drive-plan-slice`, `drive-triage-work`, `drive-discussion`. Add six new event types to the vocabulary: `spec-authored`, `spec-amended`, `plan-authored`, `plan-amended`, `triage-verdict`, `falsified-assumption`. Use an **existence-check pattern** to distinguish `*-authored` (first write) from `*-amended` (subsequent write) — keeps the emission protocol uniform across the four authoring skills.
- **Concrete metrics this unlocks**: spec-amendment rate per project (count + `reason` distribution); plan-amendment rate per slice plan (count + dispatch-resize signature); I12-halt rate per project (count of `falsified-assumption` + `triggered_by` distribution); triage stability per Linear ticket (count of `triage-verdict` events; re-triage signal).
- **Assumes.** The same additive-emit pattern that worked for `drive-build-workflow` (one Emit blockquote per anchor, citing the vocab + emission docs, behaviour-preserving) extends mechanically to the 6 new skills. Validated by inspection of each skill body's workflow structure — each has a clear "write the spec/plan" or "emit verdict" step that's the natural anchor.
- **Alternatives rejected.** (a) Land slice 1 build-loop-only and treat planning-chain as slice 2. Rejected because the as-shipped PR produces no consumable signal and the always-applied "fewer, larger PRs" rule favours expanding when expansion is mechanically straightforward. (b) Expand slice 1 to cover *every* drive-\* skill in one PR. Rejected because lifecycle / cadence / direct-change events have shape questions that need their own design pass; lumping them in risks vocab thrash. (c) Treat planning-time as the planning-effectiveness signal. Rejected per operator correction: planning-time is dwarfed by the build-loop time it gates AND time isn't the right proxy for quality anyway. The right proxies are amendment rate + I12-halt rate (signal that planning didn't catch a load-bearing assumption first time).
- **Implication for project plan.** Slice ordering reshaped: slice 2 now scopes lifecycle + cadence + direct-change-gap (`drive-deliver-workflow`, `drive-dispatch`, `drive-create-project`, `drive-check-health`, `drive-run-retro`, `drive-close-project`, `drive-start-workflow`'s setup-chain side); slice 3 still scopes diagnostics + assertion library + report generator + post-hoc parser. Project-DoD's "all drive-\* skills instrumented" line updated to map skills to slices and explicitly exclude QA-side skills (`drive-pr-description`, `drive-pr-walkthrough`, `drive-qa-plan`, `drive-qa-run`, `drive-code-review`) — edges of the workflow, not load-bearing for methodology effectiveness; revisit at close-out if signal demands.

#### D9. Trace vocabulary + emission protocol live in a `drive-record-traces` library skill, not project-local docs (2026-05-29).

- **Why.** D6/D8 instrumented the skills with "Emit" blockquotes that linked to `docs/drive/trace-events.md` and `docs/drive/trace-emission.md`. That made each instrumented `skills-contrib/` skill depend on a doc outside the skill cluster — the skill stopped being portable, and the links would dangle the moment the (transient) instrumentation project closed and its docs migrated or were deleted. The operator flagged this directly: the skills must be independent of local project docs.
- **Decision.** Create a `drive-record-traces` **library skill** (sibling pattern to `drive-agent-personas`): `SKILL.md` (overview + instrumented-skill table) plus `events.md` (vocabulary) and `emission.md` (protocol), migrated verbatim from the two `docs/drive/` files via `git mv`. Every instrumented skill's Emit blockquote refers to the `drive-record-traces` skill **by name** (e.g. "see the `drive-record-traces` skill — `events.md` § `{event}`"), not by a relative path into its files. The two `docs/drive/` files are removed.
- **Why by-name, not sibling-relative paths.** The first cut used `../drive-record-traces/events.md`; revised to by-name reference because the Agent Skills model treats each skill as a self-contained, independently-installable unit and defines no cross-skill file-import mechanism. A hard relative path couples the emitting skill to this skill's on-disk layout and to it being installed as an adjacent sibling — neither guaranteed. By-name reference lets the runtime resolve and load the skill, keeping every skill independently installable; it is the globally-portable form. Sibling paths only happen to work in-repo because the `prepare` hook installs the whole cluster together (`--skill '*'`).
- **Why a library skill (not a per-skill `tracing.md`).** A per-skill copy would duplicate the common envelope, append protocol, and existence-check pattern across all seven instrumented skills (and every skill added in later slices), inviting drift. Centralizing in one skill keeps a single canonical home the cluster can be checked against, and matches the existing `drive-agent-personas` co-location convention.
- **Assumes.** A library skill (no invocation contract, just reference docs) passes `validate-skills.mjs` with only `name` + `description` frontmatter — confirmed against `drive-agent-personas`, which carries exactly those fields.
- **Implication for project artifacts.** SDoD6 and the "vocab-doc location" decision in `spec.md`, the dispatch outcomes in `plan.md`, and the QA references now point at the skill location; the deliverable's substance (versioned vocabulary, shared protocol, referenced by name from every emit-site) is unchanged.

### Persona cross-pollinations

- **architect → pm.** A one-liner from the operator ("I'm more concerned with analysing future runs than retrospective runs") falsified the load-bearing assumption (retrospective-first priority) inside an architect-class trace-schema thread. The pm lens engaged for D3.
- **pm → architect.** The future-first decision made parse-from-outside obviously wrong (the parser's main justification was grading existing corpus). Architect lens re-engaged for D4–D6.

### Open questions / accepted trade-offs

- **Instrumentation footprint on skill bodies.** Each instrumented skill grows by an "Emit" section. Mitigation realized in D9: a shared `drive-record-traces` library skill owns the vocabulary + emission protocol; each instrumented skill body lists only its own event types and payload shape inline and links to the library skill.
- **Orphan-slice / direct-change trace path.** Slice 1 will resolve. Placeholder: `wip/drive-trace/<run-id>.jsonl`.
- **Post-hoc parser quality on trial corpus.** Some events will be missing or weakly inferred for uninstrumented runs. Project 1's diagnostic report flags this honestly per-event.
- **Project 2 judge calibration substrate.** Trial corpus is no longer the calibration ground truth; instrumented-run accretion is. This means Project 2 can't start its judge-calibration slice until enough instrumented runs exist (~10–20). Project 2 plan must sequence around this.
- **Cursor request_id ↔ transcript UUID mapping.** Operator surfaced "I read the request ID from the Cursor UI" — the UI request ID is not the on-disk transcript filename UUID. Not load-bearing (operator ignored it after recognising the mismatch); flagged here in case it surfaces later in slice 1 transcript-format recon.
- **Collapse-of-harnesses trend.** As models become more capable, the framework code around them collapses into the model itself (Cursor SDK, Claude Code, Cursor CLI are the canonical examples). The cascade-redesign of 2026-05-28 was already an instance of this trend at the Drive-methodology level — collapsing cross-altitude framework artefacts. Implication for Project 2: the live-experiment harness should anticipate being increasingly thin (fresh agent + canonical brief + verify outputs end-to-end), not "elaborate scaffolding." Implication for Project 1: instrumentation must remain a contract the *skill body* satisfies, not an externally-imposed scaffold the model needs the harness to enforce. Watch-item, not blocking.

---

## Part C — corroborations from external eval-craft writing (2026-05-28)

After the discussion settled and the in-repo artefacts were drafted, the operator pointed at [howtoeval.com](https://www.howtoeval.com/) ("How to Eval AI Agents — The 2026 Guide", Ben Hylak). Reading it corroborated most of the design and sharpened five anchors, all amended inline in the relevant section of this file or in `spec.md`:

1. **Floor-raising frame.** The framework's purpose is floor-raising the drive-* skills, not benchmark-maxxing. Composite scalars are decision-time tools at most, never the iteration headline. Amended `spec.md § Purpose` + `design-notes.md § Composite for ranking`.
2. **Golden cases as a Project 2 deliverable.** A small library of canonical Drive briefs (5–10) the live harness runs against on every skill change. Failing a golden case = don't ship the change. Folded into Project 2's Linear description.
3. **"Asking the agent" as a Project 2 auto-retro shape.** Pass an instrumented trace back to the model that produced it; ask "what would you have needed to get this right?"; treat as a clue not as truth. Folded into Project 2's Linear description.
4. **Eval-suite pruning discipline.** Assertions are a memory of refused failures, not speculative coverage; prune assertions with zero fires across N runs. Amended `spec.md § Cross-cutting requirements`.
5. **Collapse-of-harnesses trend.** Noted as a watch-item in Part B / Open questions above.

The corroborations that **did not** prompt amendments — because the design was already aligned — were: trajectory-over-final-output (we have that via trace events); code-aware-over-prompt-scored (assertions read the trace); no-hosted-eval-dashboard (we're JSONL + markdown reports per-run); diagnose-the-pattern-not-the-incident (the intent × rounds-per-dispatch cross-table is exactly this shape); production-A/B-with-pinned-models (Project 2's harness slice).

Two ideas were **considered and not adopted**: self-diagnostics via injected hidden tool (the piece walks this back; we get the equivalent via structured event emission instead, which is a better shape); workflow-scales-with-volume tiering (Stumbles → Issues → Signals → Experiments at 1–100 / 100–1000 / 1000–5000 / 5000+ runs/day — our volume is firmly Stumbles-tier; revisit when instrumented-run rate exceeds ~100/day).

---

## References

- Trial framing + recording protocol: [`drive/trial.md`](../../drive/trial.md).
- 2026-05-28 cascade-redesign ADR (the methodology change the framework will measure): [`docs/drive/design-decisions/2026-05-28-artifact-cascade-redesign.md`](../../docs/drive/design-decisions/2026-05-28-artifact-cascade-redesign.md).
- Failure-mode catalogue (the rubric Project 2's F-mode classifier will use): [`drive/calibration/failure-modes.md`](../../drive/calibration/failure-modes.md).
- Trial findings corpus (calibration substrate for Project 2's judge): `drive/<category>/findings.md` across `health / plan / pr / project / qa / retro / spec / triage`.
- Originating ticket: TML-2703 ("Measure Drive process"; renamed to `Plan: drive-instrumentation` after promotion).
- External eval-craft writing corroborating the design: ["How to Eval AI Agents — The 2026 Guide"](https://www.howtoeval.com/) by Ben Hylak. See Part C above for the five sharpenings it produced.
