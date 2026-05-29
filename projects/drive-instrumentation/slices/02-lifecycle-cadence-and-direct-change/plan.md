# Slice plan: 02-lifecycle-cadence-and-direct-change

Five dispatches, strictly sequential. Each M-sized; none L/XL.

Slice spec: [`spec.md`](./spec.md). This slice extends the slice-1 trace contract (`drive-record-traces`) with six lifecycle/cadence event types and closes the direct-change emission gap by reusing the slice-1 build-loop spine at new emit-sites in `drive-start-workflow`.

## Status

- **D1:** PENDING — vocabulary extension (6 new event types + direct-change reuse note + instrumented-skills table).
- **D2:** PENDING — lifecycle bookends (`drive-create-project`, `drive-close-project`, `drive-deliver-workflow`).
- **D3:** PENDING — cadence firings (`drive-check-health`, `drive-run-retro`).
- **D4:** PENDING — direct-change gap (`drive-start-workflow` build-loop spine).
- **D5:** PENDING — manual-QA expansion + walkthrough covering lifecycle + cadence + direct-change.

## Failure modes threaded into briefs

Each dispatch's brief threads the applicable entries from [`drive/calibration/failure-modes.md`](../../../../drive/calibration/failure-modes.md):

- **F5 (destructive git ops by subagents)** — non-negotiable, threaded into every dispatch's brief.
- **F4 (feature-sized dispatch with no inspection cadence)** — D2 (3 skills) and D4 (one skill, five emit-sites + a sub-path it must not rewrite) are the most-at-risk; WIP-inspection at the midpoint with an explicit "halt and surface if the diff grows beyond the named skill bodies / beyond additive blockquotes" rule.
- **F3 (discovery via test suite vs grep)** — D5's verification is "read the produced trace.jsonl against the checklist," not "re-walk the skill bodies." Pre-stage the read checklist.

The most plausible scope creep across D2–D4 is "while I'm here, instrument `drive-dispatch` / a QA-side skill / add a trace reader" — all explicitly out per slice spec § Scope. `drive-dispatch` staying uninstrumented is a deliberate design refinement (spec § `drive-dispatch` stays uninstrumented), not an omission.

## Grep gates

No entries from [`drive/calibration/grep-library.md`](../../../../drive/calibration/grep-library.md) directly apply. Verification is "read the produced trace.jsonl," not "grep the codebase." One grep gate is local to this slice: after D2–D4, `rg "> \*\*Emit" skills-contrib/drive-dispatch/SKILL.md` must return **no** matches (drive-dispatch stays clean).

## Dispatches

### Dispatch 1: Vocabulary extension + direct-change reuse note

**Intent.** Extend `skills-contrib/drive-record-traces/events.md` with the six lifecycle/cadence event types (`project-started`, `project-closed`, `slice-started`, `slice-completed`, `health-check-fired`, `retro-landed`), each with payload table + arktype schema + JSONL example, following the section pattern D1/D4 established. Add a short note (to `events.md` and/or `emission.md`) documenting that a **direct change reuses the build-loop spine** (`dispatch-start`/`round-start`/`brief-issued`/`round-end`/`dispatch-end`) fired from `drive-start-workflow`, with `project_run_id = "direct-<ISO-ts>"` per `emission.md` path resolution. Extend the `drive-record-traces` `SKILL.md` instrumented-skills table to list the slice-2 emitters. Resolve OQ1 (union naming) — pick the lower-churn option and record it.

**Files in play.**

- `skills-contrib/drive-record-traces/events.md` (edit, additive).
- `skills-contrib/drive-record-traces/emission.md` (edit, additive — the direct-change reuse note).
- `skills-contrib/drive-record-traces/SKILL.md` (edit — instrumented-skills table).

NOT in play: any instrumented skill body; QA artefacts.

**"Done when":**

- [ ] Six new event types documented in `events.md` with payload tables + arktype + JSONL examples; additive to the existing one-section-per-event structure.
- [ ] Each new section names the emitting skill and the trigger condition, consistent with `spec.md § Chosen design § New event types`.
- [ ] A direct-change reuse note documents the build-loop-spine reuse from `drive-start-workflow` (`project_run_id = "direct-<ISO-ts>"`), pointing at the five existing build-loop event types.
- [ ] The vocabulary union covers all event types; OQ1 resolved (canonical union name chosen; alias kept if lower-churn) and noted inline.
- [ ] `schema_version` stays `"1"` (additive).
- [ ] `drive-record-traces` `SKILL.md` instrumented-skills table lists `drive-create-project`, `drive-close-project`, `drive-deliver-workflow`, `drive-check-health`, `drive-run-retro`, and the `drive-start-workflow` direct-change spine.
- [ ] Intent-validation: `git diff --stat <base>..HEAD` lists exactly the three `drive-record-traces` files.
- [ ] Markdown well-formed; cross-references resolve.

**Size.** M (~2h). 6 event types × ~30 lines + the reuse note + table edit.

**DoR confirmed:** ✓ — payload sketches in spec are precise; reason/enum values named; existing events.md structure is the template.

---

### Dispatch 2: Instrument lifecycle bookend skills (3 skills, 4 emit-sites)

**Intent.** Add Emit blockquotes for the project/slice lifecycle bookends:

- `skills-contrib/drive-create-project/SKILL.md` — `project-started` after the workspace-scaffold step, before the DoR gate.
- `skills-contrib/drive-close-project/SKILL.md` — `project-closed` at the terminal close-out-PR step.
- `skills-contrib/drive-deliver-workflow/SKILL.md` — `slice-started` (Step 3, before invoking `drive-build-workflow`) and `slice-completed` (Step 4, after the slice PR merges).

Each emit-site is the same shape as D2/D5a of slice 1: a 1–3-line Emit blockquote referencing the `drive-record-traces` skill **by name** (no relative path). Anchor-discovery is the implementer's first task — confirm the live anchor against the skill body per `spec.md § Approach § Instrumentation` table.

**Files in play.**

- `skills-contrib/drive-create-project/SKILL.md` (edit, additive).
- `skills-contrib/drive-close-project/SKILL.md` (edit, additive).
- `skills-contrib/drive-deliver-workflow/SKILL.md` (edit, additive).

NOT in play: any other skill body; docs; QA artefacts; `drive-dispatch`.

**"Done when":**

- [ ] Four Emit blockquotes total at the named anchors (1 + 1 + 2).
- [ ] Each emit-site references the `drive-record-traces` skill by name (its `events.md` + `emission.md`), no relative path.
- [ ] `slice-started` carries `slice_index` (1-based plan position); `slice-completed` carries `result` (`"merged"` | `"abandoned"`).
- [ ] No other section of any skill body is materially changed; additive-only.
- [ ] Behaviour-preservation read-through per skill (quote one before/after fragment adjacent to each emit-site).
- [ ] Intent-validation: `git diff --stat <base>..HEAD` lists exactly the three named files.

**Size.** M (~1.5h). 3 skill bodies; pattern identical to slice-1 D2/D5a; anchor-discovery is the main cost.

**DoR confirmed:** ✓ — anchors named in spec; pattern proven by slice 1.

**WIP-inspection cadence** (per F4): one inspection after 2 skills instrumented, confirming the diff is within the three named files.

---

### Dispatch 3: Instrument cadence skills (2 skills)

**Intent.** Add one Emit blockquote per skill:

- `skills-contrib/drive-check-health/SKILL.md` — `health-check-fired` at Step 4 after the rollup renders, carrying `cadence`, `drift_signal_count`, `max_drift_severity`, `recommended_next`.
- `skills-contrib/drive-run-retro/SKILL.md` — `retro-landed` at Step 7 after the retro entry is appended, carrying `trigger_class`, `landing_surfaces`, `is_mandatory_final`. Fires only on landing (the retro's "not done until the output lands" stance) — an un-landed retro is silent.

**Files in play.**

- `skills-contrib/drive-check-health/SKILL.md` (edit, additive).
- `skills-contrib/drive-run-retro/SKILL.md` (edit, additive).

NOT in play: any other skill body; docs; QA artefacts.

**"Done when":**

- [ ] Two Emit blockquotes (one per skill) at the named anchors.
- [ ] `health-check-fired`'s `cadence` enum covers `opening-rollup`/`per-slice-merge`/`closing-rollup`/`session-bookend`/`trigger-fired`; the emit instruction notes the cadence is read from the invoking context.
- [ ] `retro-landed` fires only at the landing step (Step 7); the emit instruction documents that an un-landed retro is silent.
- [ ] Each emit-site references the `drive-record-traces` skill by name, no relative path.
- [ ] No other section materially changed; additive-only.
- [ ] Behaviour-preservation read-through per skill.
- [ ] Intent-validation: `git diff --stat <base>..HEAD` lists exactly the two named files.

**Size.** M (~1h). 2 skill bodies; smaller than D2.

**DoR confirmed:** ✓ — anchors named; cadence/trigger enums named in spec.

---

### Dispatch 4: Close the direct-change gap (drive-start-workflow)

**Intent.** Add five Emit blockquotes to `skills-contrib/drive-start-workflow/SKILL.md` Step 5 **direct-change sub-path**, reusing the slice-1 build-loop spine to make one-shot direct changes visible:

- Before the `drive-dispatch` call (items 3–4): `dispatch-start` (`dispatch_name = "direct-change <ticket>"`, `parent_dispatch_id = null`), `round-start` (`round_number = 1`), `brief-issued` (`brief_disposition = "initial"`).
- After `drive-dispatch` returns: `round-end` (verdict mapped per OQ3), `dispatch-end` (result mapped).

Trace-file resolution is the existing direct-change path (`wip/drive-trace/direct-<ISO-ts>.jsonl`, `project_run_id = "direct-<ISO-ts>"`). This is the only dispatch touching `drive-start-workflow`; it must NOT instrument the other verdict sub-paths (slice/project paths already emit via the skills they call) and must NOT add an emit-site to `drive-dispatch`. OQ3 (verdict mapping) resolved here against the direct-change sub-path's actual outcomes.

**Files in play.**

- `skills-contrib/drive-start-workflow/SKILL.md` (edit, additive — direct-change sub-path only).

NOT in play: any other skill body; `drive-dispatch`; docs; QA artefacts.

**"Done when":**

- [ ] Five Emit blockquotes on the direct-change sub-path (three before the dispatch call, two after), reusing the build-loop event types.
- [ ] `dispatch-start` uses `dispatch_name = "direct-change <ticket>"`, `parent_dispatch_id = null`; `round-start` uses `round_number = 1`; `brief-issued` uses `brief_disposition = "initial"`.
- [ ] OQ3 resolved: `round-end.verdict` mapping for success / stop-condition documented in the emit instruction.
- [ ] Each emit-site references the `drive-record-traces` skill by name, no relative path; trace-file path resolves to the direct-change row.
- [ ] No other verdict sub-path is instrumented; `drive-dispatch` gets no emit-site (`rg "> \*\*Emit" skills-contrib/drive-dispatch/SKILL.md` returns nothing).
- [ ] No other section materially changed; additive-only.
- [ ] Behaviour-preservation read-through of the direct-change sub-path.
- [ ] Intent-validation: `git diff --stat <base>..HEAD` lists exactly `skills-contrib/drive-start-workflow/SKILL.md`.

**Size.** M (~1.5h). One skill body; five emit-sites; the care is in not disturbing the surrounding sub-path prose.

**DoR confirmed:** ✓ — anchors (items 3–4 + post-return) named in spec; the gap and the reuse are precisely specified.

**WIP-inspection cadence** (per F4): one inspection after the three pre-call emits, confirming the post-call emits and the no-other-subpath constraint hold.

---

### Dispatch 5: Manual-QA expansion + walkthrough

**Intent.** Extend `manual-qa.md` with checks covering the six new event types + the direct-change spine, then run a synthetic walkthrough producing a committed `qa-trace` and a run report with hand-computed signals. The walkthrough exercises: a `project-started` → slice bookends (`slice-started`/`slice-completed`) → opening/per-slice/closing `health-check-fired` → a triggered `retro-landed` + the mandatory-final → `project-closed` arc, plus a standalone direct-change run producing the five-event spine under a `direct-<ts>` run id.

**Files in play.**

- `projects/drive-instrumentation/slices/02-…/manual-qa.md` (new).
- `projects/drive-instrumentation/slices/02-…/qa-run-01.md` (new).
- `projects/drive-instrumentation/slices/02-…/qa-trace-01.jsonl` (new — lifecycle + cadence arc).
- `projects/drive-instrumentation/slices/02-…/qa-trace-direct-01.jsonl` (new — direct-change spine under a `direct-<ts>` run id).

NOT in play: slice-1 QA artefacts (immutable historical record).

**"Done when":**

- [ ] `manual-qa.md` has ≥ 1 check per new event type (6) plus structural checks: project/slice bookend pairing, cadence-enum coverage, retro-landing-only semantics, direct-change spine completeness, `drive-dispatch`-stays-clean grep gate.
- [ ] `qa-trace-01.jsonl` contains the lifecycle + cadence arc; `qa-trace-direct-01.jsonl` contains the five-event direct-change spine with `project_run_id = "direct-<ts>"`; every line parses as JSON and matches the documented payload shape.
- [ ] `qa-run-01.md` records the walkthrough + hand-computes: project wall-clock (`project-closed.ts − project-started.ts`), per-slice wall-clock, `health-check-fired` count + cadence distribution, `retro-landed` count + trigger-class distribution, direct-change dispatch visibility (spine present).
- [ ] Behaviour-preservation read-through across all six newly instrumented skill bodies (sample one paragraph adjacent to an emit-site each) + the direct-change sub-path.
- [ ] All checks pass; status line "no unresolved 🛑 Blocker findings."
- [ ] Intent-validation: `git diff --stat <base>..HEAD` lists exactly the four named QA files.

**Size.** M (~2h, dominated by the two-trace walkthrough construction).

**DoR confirmed:** ✓ — pattern proven by slice-1 D3/D6; synthetic-scenario shape concrete; metric formulas named in spec § At a glance.

---

## Sanity checks

- ✓ Each dispatch sized M (none L/XL).
- ✓ Each dispatch's "done when" is binary + verifiable on disk.
- ✓ Every slice-spec edge case is either covered by a dispatch's "done when" or explicitly out-of-scope.
- ✓ Slice-DoD's eight items are reachable from the dispatch sequence.
- ✓ Sequence is acyclic: D1's vocab is input to D2/D3/D4's emit-site citations; D2/D3/D4's instrumented skills are inputs to D5's walkthrough.

## Hand-off

Hand off to [`drive-build-workflow`](../../../../skills-contrib/drive-build-workflow/SKILL.md) to pilot the dispatch loop. Next dispatch: D1 (vocabulary extension).
