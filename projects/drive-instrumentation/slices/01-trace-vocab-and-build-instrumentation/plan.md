# Slice plan: 01-trace-vocab-and-build-instrumentation

Seven dispatches, strictly sequential. Each M-sized; none L/XL.

Slice spec: [`spec.md`](./spec.md). Spec re-specified 2026-05-28 to expand scope from build-loop-only instrumentation to build-loop + planning-chain instrumentation (D4–D6 added).

## Status

- **D1: SATISFIED** — `5bdc19013`. Build-loop event vocabulary (`docs/drive/trace-events.md`) and shared emission protocol (`docs/drive/trace-emission.md`).
- **D2: SATISFIED** — `42feffeb4`. Five emit-sites in `skills-contrib/drive-build-workflow/SKILL.md` at canonical anchors.
- **D3: SATISFIED** — `849f10598`. `manual-qa.md` + `qa-run-01.md` + `qa-trace-01.jsonl` (build-loop event coverage; 13 events across a synthetic 2-dispatch / 3-round scenario).
- **D4: SATISFIED** — `4156a84c8` + orchestrator fixup `7a8b3e6fe`. Six planning-chain event types added to `docs/drive/trace-events.md`; existence-check subsection added to `docs/drive/trace-emission.md`. F2 + F3 (low/process JSONL + anchor nits) closed in fixup commit.
- **D5a: SATISFIED** — `21dc8c0d0`. Four spec+plan lifecycle skills instrumented with existence-check-gated Emit blockquotes (+2 lines each, +8 total). `drive-specify-slice` correctly gates emission on in-project mode; `drive-plan-slice` correctly handles both inline-in-spec and separate-plan.md write modes with mode-specific `plan_path` resolution. Two non-blocking findings (F4 ⚠️ Concern, F5 💡 Suggestion) about abbreviated payload listings — consistent with D2's blockquote-density pattern, doc cites cover the full schema; orchestrator accepts as-is.
- **D5b: SATISFIED** — `00165a337` + orchestrator fixup (F6 closed). `drive-triage-work` and `drive-discussion` instrumented with one Emit blockquote each. F6 (Blocker) was a brief-was-wrong issue: D5b brief incorrectly said T3+T4 both fire `falsified-assumption`; vocab + plan contract is T3-only. Fix-orchestrator-direct: drive-discussion emit blockquote corrected to T3-only with explicit T4-silent note.
- **D6: SATISFIED** — `05b4e171e`. `manual-qa.md` extended with 13 new checks (8–20) covering the six planning-chain event types plus 7 structural gates (existence-check, I12-T3-only, re-triage, verdict mapping, orphan silence, plan-slice dual-mode). `qa-trace-02.jsonl` (23 events, all 11 types). `qa-run-02.md` (20/20 checks pass; all 6 quality metrics hand-computed; behaviour-preservation attested across all seven instrumented skills). **Slice 1 SATISFIED at close.**

## Failure modes threaded into briefs

Each dispatch's brief threads the applicable entries from [`drive/calibration/failure-modes.md`](../../../../drive/calibration/failure-modes.md):

- **F5 (destructive git ops by subagents)** — non-negotiable, threaded into every dispatch's brief.
- **F4 (feature-sized dispatch with no inspection cadence)** — D5a (4 skills in one dispatch) is the most-at-risk; WIP-inspection at the midpoint, with the explicit "halt and surface if diff grows beyond the 4 named skill bodies" rule.
- **F3 (discovery via test suite vs grep)** — D6's verification could fall into "re-walk the skill bodies to discover what's missing"; pre-stage the checklist of what to read from the trace.

Scope traps from [`drive/calibration/failure-modes.md § Slice-shape scope traps`](../../../../drive/calibration/failure-modes.md#slice-shape-scope-traps) do not apply directly. The most plausible scope creep in D5a / D5b is "while I'm here, instrument lifecycle skills too" — explicitly out per slice spec § Out of scope.

## Grep gates

No entries from [`drive/calibration/grep-library.md`](../../../../drive/calibration/grep-library.md) directly apply. Verification is "read the produced trace.jsonl," not "grep the codebase."

## Dispatches

### Dispatch 1: Vocabulary + emission-protocol docs — SATISFIED

Commit `5bdc19013`. Shipped the five build-loop event types + emission protocol.

### Dispatch 2: Instrument drive-build-workflow — SATISFIED

Commit `42feffeb4`. Five additive emit-sites at the canonical per-dispatch-loop anchors.

### Dispatch 3: Manual-QA script + first run — SATISFIED

Commit `849f10598`. `manual-qa.md` (149 lines, 7-check re-runnable script); `qa-trace-01.jsonl` (13 events); `qa-run-01.md` (pass/fail + hand-computed metrics).

---

### Dispatch 4: Vocabulary expansion for planning-chain events

**Intent.** Extend `docs/drive/trace-events.md` with the six planning-chain event types (`spec-authored`, `spec-amended`, `plan-authored`, `plan-amended`, `triage-verdict`, `falsified-assumption`) and the corresponding arktype schemas. Extend `docs/drive/trace-emission.md` with a short addendum on the existence-check pattern (file-exists → emit `*-amended`; else → emit `*-authored`). Payload schemas per the sketches in `spec.md § Approach § Vocabulary shape § Planning-chain payload sketches` — D4 finalises them.

**Files in play.**

- `docs/drive/trace-events.md` (edit, additive).
- `docs/drive/trace-emission.md` (edit, additive — the addendum).

NOT in play: any skill body; the QA artefacts; any new file outside the two docs.

**"Done when":**

- [ ] Six new event types documented in `docs/drive/trace-events.md` with payload schemas + arktype types + JSONL examples. The doc's existing structure (one section per event type, following the pattern D1 established for the five build-loop events) is preserved; new sections are additive.
- [ ] Each new event type's section names the emitting skill(s) and the trigger condition, consistent with the table in `spec.md § Approach § Vocabulary shape`.
- [ ] `trace-emission.md` gains a short subsection on the existence-check pattern (≤ 20 lines, sample bash check, link back to the `*-authored` / `*-amended` event types in `trace-events.md`).
- [ ] The vocabulary-version field stays at `schema_version: "1"` (no major-version bump — additive).
- [ ] Intent-validation: `git diff --stat 849f10598..HEAD` lists exactly two files: `docs/drive/trace-events.md` and `docs/drive/trace-emission.md`.
- [ ] Markdown well-formed; cross-references resolve.

**Size.** M (~2h). 6 event types × ~30 lines each in trace-events.md plus the trace-emission.md addendum.

**DoR confirmed:** ✓ — payload-field sketches in spec.md are precise enough that the implementer can author schemas; reason-code enums named; trigger conditions named; the existing trace-events.md structure is the template.

---

### Dispatch 5a: Instrument spec + plan lifecycle skills (4 skills)

**Intent.** Add one Emit blockquote per skill body (4 skills × 1 emit-site each = 4 emit-sites total) in:

- `skills-contrib/drive-specify-project/SKILL.md` — emits `spec-authored` OR `spec-amended` at the spec-write step (existence-check pattern).
- `skills-contrib/drive-specify-slice/SKILL.md` — same shape for slice specs.
- `skills-contrib/drive-plan-project/SKILL.md` — emits `plan-authored` OR `plan-amended` at the plan-write step.
- `skills-contrib/drive-plan-slice/SKILL.md` — same shape for slice plans.

Each emit-site is the same shape as D2's: a 1–3-line Emit blockquote citing `docs/drive/trace-events.md` (payload schema) and `docs/drive/trace-emission.md` (file-append mechanics + the existence-check addendum). Anchor-discovery is the implementer's first task — find the "write the spec/plan" step in each skill body and place the emit-site immediately after the write, before the skill returns control to its caller.

**Files in play.**

- `skills-contrib/drive-specify-project/SKILL.md` (edit, additive).
- `skills-contrib/drive-specify-slice/SKILL.md` (edit, additive).
- `skills-contrib/drive-plan-project/SKILL.md` (edit, additive).
- `skills-contrib/drive-plan-slice/SKILL.md` (edit, additive).

NOT in play: any other skill body; docs; QA artefacts.

**"Done when":**

- [ ] One Emit blockquote per skill body at the post-write anchor. Four files modified, ~5–10 lines each, ~30 lines total.
- [ ] Each emit-site cites both `docs/drive/trace-events.md` and `docs/drive/trace-emission.md`.
- [ ] The existence-check pattern is correctly applied in each emit-site (the Emit instruction itself names the check: "if the target file exists at write time, emit `*-amended`; else emit `*-authored`").
- [ ] No other section of any skill body is materially changed; additive-only.
- [ ] Behaviour-preservation read-through: each skill body's "write the spec/plan" workflow step is unchanged in semantics; quote one before/after fragment in the return report.
- [ ] Intent-validation: `git diff --stat <prior-head>..HEAD` lists exactly four files, all under `skills-contrib/drive-{specify,plan}-{project,slice}/SKILL.md`.
- [ ] Edge cases: "Spec re-authored verbatim" → existence-check correctly emits `spec-amended` even when `bytes_delta = 0`. "Same skill emits both event types in same session" → existence-check sees file present on second write.

**Size.** M (~1.5h). 4 skill bodies are small (~5–8 kb each); pattern is identical to D2; anchor-discovery is the main cost.

**DoR confirmed:** ✓ — anchor guidance in spec; pattern proven by D2; existence-check approach documented.

**WIP-inspection cadence** (per F4 mitigation): one inspection at the midpoint (after 2 skills instrumented) to confirm the diff is still strictly within the 4 named files.

---

### Dispatch 5b: Instrument triage + I12 skills (2 skills)

**Intent.** Add one Emit blockquote per skill body in:

- `skills-contrib/drive-triage-work/SKILL.md` — emits `triage-verdict` at the verdict-output step.
- `skills-contrib/drive-discussion/SKILL.md` — emits `falsified-assumption` at the on-entry step, **gated on trigger being a mid-flight I12 falsified-assumption** (the conditional emission discipline is part of the emit instruction itself).

**Files in play.**

- `skills-contrib/drive-triage-work/SKILL.md` (edit, additive).
- `skills-contrib/drive-discussion/SKILL.md` (edit, additive).

NOT in play: any other skill body; docs; QA artefacts.

**"Done when":**

- [ ] Two Emit blockquotes (one per skill body) at the named anchors.
- [ ] `drive-discussion`'s emit-site explicitly documents the I12-trigger gating — the emit fires only when discussion was entered to address a mid-flight falsified assumption; other entry triggers (pre-spec design, mid-spec fork, operator-requested, unplanned obstacle) do NOT emit. The gating logic lives inside the Emit instruction itself.
- [ ] `drive-triage-work`'s emit-site fires on every triage verdict (no gating; multiple triage calls per ticket → multiple events).
- [ ] Each emit-site cites both `docs/drive/trace-events.md` and `docs/drive/trace-emission.md`.
- [ ] No other section of either skill body is materially changed; additive-only.
- [ ] Behaviour-preservation read-through per skill.
- [ ] Intent-validation: `git diff --stat <prior-head>..HEAD` lists exactly two files.
- [ ] Edge cases: "drive-discussion entered for non-I12 reason" → no emit; "Triage re-runs mid-flight (promote)" → second verdict event fires with `input_shape = "mid-flight-scope-signal"`.

**Size.** M (~1h). 2 skill bodies; smaller than D5a.

**DoR confirmed:** ✓ — anchor guidance in spec; pattern identical to prior dispatches; conditional emission for drive-discussion is the only novel element and is captured in the brief.

---

### Dispatch 6: Manual-QA expansion + second walkthrough

**Intent.** Extend `manual-qa.md` with checks covering the six planning-chain event types (each event's payload-shape verification, the existence-check semantics for `*-authored` / `*-amended` pairing, the I12-trigger gating for `falsified-assumption`, the per-ticket re-triage signal for `triage-verdict`). Execute a second walkthrough on a richer synthetic scenario that exercises all eleven event types, producing `qa-trace-02.jsonl` (more events than `qa-trace-01.jsonl`) and `qa-run-02.md` recording the run + hand-computed metrics for all six new quality signals.

**Files in play.**

- `projects/drive-instrumentation/slices/01-…/manual-qa.md` (edit, expand).
- `projects/drive-instrumentation/slices/01-…/qa-run-02.md` (new).
- `projects/drive-instrumentation/slices/01-…/qa-trace-02.jsonl` (new).

NOT in play: `qa-run-01.md` (D3's run, immutable historical record), `qa-trace-01.jsonl` (same).

**"Done when":**

- [ ] `manual-qa.md` extended with at least 6 new checks (one per new event type at minimum) plus additional structural checks (existence-check correctness; I12-trigger gating correctness; per-ticket re-triage correctness). The seven existing checks for the build-loop spine are preserved.
- [ ] `qa-trace-02.jsonl` exists; contains ≥ 1 event of each of the eleven event types; every line parses as JSON; every event matches the documented payload shape.
- [ ] Synthetic scenario in `qa-run-02.md` includes: (a) a project-spec being authored + amended once, (b) a slice-spec being authored, (c) a slice-plan being authored, (d) a triage verdict for a Linear ticket plus a re-triage (promote) for the same ticket, (e) an I12 halt with `falsified-assumption` firing + subsequent `spec-amended` with `reason = "replan-from-discussion"`, (f) the build-loop dispatches that follow.
- [ ] `qa-run-02.md` records the walkthrough: scenario summary, observations per check, pass/fail per check, hand-computed metrics:
  - `rounds_per_dispatch` (already from D3 — preserved).
  - Spec-amendment rate (count of `spec-amended` per project; reason-code distribution).
  - Plan-amendment rate (count of `plan-amended` per slice plan).
  - I12-halt rate (count of `falsified-assumption` per project; trigger distribution).
  - Triage stability (count of `triage-verdict` per `input_ref`; > 1 = re-triages).
- [ ] Behaviour-preservation read-through across all seven instrumented skill bodies (sample one paragraph adjacent to an emit-site in each).
- [ ] All checks (existing seven + new six+) pass; status line "no unresolved 🛑 Blocker findings."
- [ ] Intent-validation: `git diff --stat <prior-head>..HEAD` lists exactly the three named files.

**Size.** M (~2h, dominated by the richer walkthrough construction).

**DoR confirmed:** ✓ — pattern proven by D3; the synthetic-scenario shape (project + slice + triage + I12 + replan + build-loop) is concrete; metric formulas are named.

**WIP-inspection cadence** (per F4 / F3 mitigation): one inspection mid-walkthrough to confirm the trace doesn't drift off-template; one final cross-check before the run report is written.

---

## Sanity checks

- ✓ Each dispatch sized M (none L/XL).
- ✓ Each dispatch's "done when" is binary + verifiable on disk.
- ✓ Every slice-spec edge case is either covered by a dispatch's "done when" or explicitly out-of-scope.
- ✓ Slice-DoD's eight items are reachable from the dispatch sequence.
- ✓ Sequence is acyclic: D1's docs are inputs to D2/D5a/D5b's emit-site citations; D4's expanded vocab is input to D5a/D5b's payload-field hints in the Emit blockquotes; D2/D5a/D5b instrumented skills are inputs to D6's walkthrough.

## Hand-off

Hand off to [`drive-build-workflow`](../../../../skills-contrib/drive-build-workflow/SKILL.md) to pilot the dispatch loop. Next dispatch: D4 (vocabulary expansion).
