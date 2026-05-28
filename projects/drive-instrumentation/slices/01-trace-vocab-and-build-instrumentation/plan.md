# Slice plan: 01-trace-vocab-and-build-instrumentation

Three dispatches, strictly sequential. Each is M-sized; no L/XL.

Slice spec: [`spec.md`](./spec.md). Spec re-specified 2026-05-28 against canonical `drive-build-workflow` structure (D2's instrumentation table now references the canonical 6-step loop instead of the stale 5-step protocol).

## Status

- **D1: SATISFIED** — commit `5bdc19013`. Docs landed at `docs/drive/trace-events.md` + `docs/drive/trace-emission.md`. Reviewer verdict ANOTHER ROUND NEEDED on round 1 with one finding F1 (`low/process`); F1 has since been resolved environmentally (the cited path `skills-contrib/drive-build-workflow/SKILL.md` is correct against the canonical-vs-presentation contract, restored by wiping `.agents/skills/` + re-running `pnpm install`). No D1 doc edit required.
- **D2: pending re-dispatch** — instrumentation of `skills-contrib/drive-build-workflow/SKILL.md` (canonical path) at the new anchors documented in `spec.md § Approach § drive-build-workflow instrumentation`.
- **D3: pending** — manual-QA script + first run.

## Failure modes threaded into briefs

Each dispatch's brief threads the applicable entries from [`drive/calibration/failure-modes.md`](../../../../drive/calibration/failure-modes.md):

- **F5 (destructive git ops by subagents)** — non-negotiable, threaded into every dispatch's brief.
- **F4 (feature-sized dispatch with no inspection cadence)** — Dispatch 2 is the most-at-risk (skill-body instrumentation that could spread). WIP-inspection cadence at the midpoint enforced.
- **F3 (discovery via test suite vs grep)** — Dispatch 3's verification could fall into "re-run drive-build-workflow to discover what's broken" if the instrumentation is wrong. Threaded into D3 with a pre-computed checklist of what to read from the trace.

Not directly applicable to slice 1's shape: F1 (dual-shape support relocated), F2 (constructor magic), F6 / F7 (orchestrator-side, not subagent-side), F8 (recon scan scope), F9 (line-oriented grep on structured files).

Scope traps from [`drive/calibration/failure-modes.md § Slice-shape scope traps`](../../../../drive/calibration/failure-modes.md#slice-shape-scope-traps) do not apply directly. The most plausible scope creep is "while I'm here, instrument `drive-dispatch` too" — explicitly out per slice spec § Out of scope.

## Grep gates

No entries from [`drive/calibration/grep-library.md`](../../../../drive/calibration/grep-library.md) directly apply to this slice's shape. The verification path is "read the produced trace.jsonl," not "grep the codebase."

## Dispatches

### Dispatch 1: Vocabulary + emission-protocol docs — SATISFIED

**Intent.** Write `docs/drive/trace-events.md` and `docs/drive/trace-emission.md` per `spec.md § Approach`.

**Status.** SATISFIED. Commit `5bdc19013`, signoff present, scope strictly 2 files (+283 lines). Reviewer round 1 verdict (`ANOTHER ROUND NEEDED` with F1) was based on a transient drift state in `.agents/skills/` vs `skills-contrib/` that has since been reconciled. F1's recommended action ("change line 180 to point at `.agents/skills/...`") is now incorrect — the original `skills-contrib/...` reference is right against the canonical contract. F1 closed as obsolete; no further D1 action required.

**Done.** D1 needs no further work.

---

### Dispatch 2: Instrument drive-build-workflow

**Intent.** Add five "Emit" steps to `skills-contrib/drive-build-workflow/SKILL.md`, one per slice-1 event type, at the anchors named in `spec.md § Approach § drive-build-workflow instrumentation`. Each emit step is a 1–3-line instruction referencing `docs/drive/trace-emission.md § Append protocol` for the file-append mechanics and `docs/drive/trace-events.md` for the payload schema. The skill body grows by ~30–75 lines total; the existing `## The per-dispatch loop` structure is the anchor — no restructuring, additive-only edits.

**Files in play.**

- `skills-contrib/drive-build-workflow/SKILL.md` (edit).

NOT in play: `.agents/skills/drive-build-workflow/SKILL.md` (gitignored; regenerated from `skills-contrib/` at install time), `skills-contrib/drive-dispatch/SKILL.md` (slice 2's territory).

**"Done when":**

- [ ] Five emit-sites land in `skills-contrib/drive-build-workflow/SKILL.md` at the five anchors named in `spec.md § Approach § drive-build-workflow instrumentation`. The per-round temporal sequence is honoured (`dispatch-start → round-start → brief-issued → drive-dispatch → ... → round-end → next round | dispatch-end`).
- [ ] Each emit-site cites both `docs/drive/trace-events.md` (payload schema) and `docs/drive/trace-emission.md` (file-append mechanics).
- [ ] No other section of the skill body is materially changed. Incidental typos / formatting tolerated; workflow semantics untouched; no restructuring.
- [ ] Behaviour-preservation check (reading-level): before and after the patch, the workflow's described behaviour for each loop step is unchanged. Confirm in the return report by quoting one before/after fragment for a step you didn't touch (to demonstrate surrounding prose intact) and the diff fragment for a step you did touch (to demonstrate additive insertion).
- [ ] Markdown well-formed.
- [ ] Intent-validation: `git diff --stat 5bdc19013..HEAD` lists exactly one file: `skills-contrib/drive-build-workflow/SKILL.md`. Any other file in the diff is an out-of-scope leak — halt and surface.
- [ ] Edge cases (from slice spec) addressed where applicable: "Operator amends drive-build-workflow skill body mid-slice" — if the cited anchor doesn't actually exist in the skill body, halt and surface rather than improvising. "Canonical-vs-presentation drift" — if the implementer observes that `.agents/skills/` does not match `skills-contrib/` for `drive-build-workflow` at start-of-dispatch, halt and surface.

**Size.** M (~1.5–2h estimated). The canonical body is 29.6kb (~600 lines); the per-dispatch-loop section is well-bounded. Five emit-sites at well-named anchors.

**DoR confirmed:** ✓ — intent clear, file named (the canonical, tracked one), "done when" binary, size M, F4 + F5 threaded, anchors are concrete sections the implementer can find with `rg '^### ' skills-contrib/drive-build-workflow/SKILL.md`. No silent design decisions — the emit-site placement table in `spec.md § Approach` pins each event's anchor.

**WIP-inspection cadence** (per F4 mitigation): one inspection at the implementer's first heartbeat after starting the file edit, OR at ~30 min in if no heartbeat fired. Inspection reads the diff to confirm scope is still strictly `skills-contrib/drive-build-workflow/SKILL.md`.

---

### Dispatch 3: Manual-QA script + first run

**Intent.** Author `manual-qa.md` (the QA script that exercises the instrumented `drive-build-workflow` end-to-end on a small in-repo task) and execute one run end-to-end, producing `qa-run-01.md` (the run report) + `qa-trace-01.jsonl` (the emitted trace as evidence). The run may be a walkthrough where the implementer simulates the orchestrator's emit decisions at each anchor in the instrumented skill body and writes the expected JSONL; full-real-agent dispatch is not required. Verification is structural (trace matches the documented vocabulary?) and metric-computable (`rounds_per_dispatch` + narrow brief-churn metric hand-computable from the trace?).

**Files in play.**

- `projects/drive-instrumentation/slices/01-trace-vocab-and-build-instrumentation/manual-qa.md` (new).
- `projects/drive-instrumentation/slices/01-trace-vocab-and-build-instrumentation/qa-run-01.md` (new).
- `projects/drive-instrumentation/slices/01-trace-vocab-and-build-instrumentation/qa-trace-01.jsonl` (new — committed as evidence even though canonical run paths are gitignored).

**"Done when":**

- [ ] `manual-qa.md` exists; describes the seven QA checks named in `spec.md § Approach § Demo + manual QA`; is structured as a re-runnable checklist.
- [ ] `qa-run-01.md` records the run: date, task chosen for the demo, observations against each of the seven QA checks, pass/fail per check, "no unresolved 🛑 Blocker findings" status line at the end.
- [ ] `qa-trace-01.jsonl` exists, contains at least one event of each of the five slice-1 event types, every line parses as JSON, every event matches the documented payload shape from `docs/drive/trace-events.md`.
- [ ] `rounds_per_dispatch` (count of `round-end` events grouped by `dispatch_id`) shown computed by hand in `qa-run-01.md` for at least one dispatch.
- [ ] Brief-churn narrow metric (sum of `brief-issued.brief_byte_length` per dispatch / max `brief-issued.brief_byte_length` per dispatch) shown computed by hand.
- [ ] Behaviour-preservation check: the diff produced on the small in-repo task by the instrumented `drive-build-workflow` walkthrough matches what an uninstrumented walkthrough would produce. Recorded in `qa-run-01.md`.
- [ ] Intent-validation: diff strictly limited to the three new files in the slice folder.
- [ ] Edge cases (from slice spec) covered: trace-file-on-first-emit verified; each event-type schema exercised; the seven QA checks cover the load-bearing slice spec edge cases that aren't structurally out-of-scope.

**Size.** M (~1.5–2h estimated, dominated by the walkthrough execution).

**DoR confirmed:** ✓ — intent clear, files named, "done when" binary, size M, F3 + F5 threaded.

**WIP-inspection cadence** (per F4 mitigation): one inspection mid-walkthrough.

---

## Sanity checks

- ✓ Each dispatch sized M (none L/XL).
- ✓ Each dispatch's "done when" is binary + verifiable on disk.
- ✓ Every slice-spec edge case is either covered by a dispatch's "done when" or explicitly out-of-scope.
- ✓ Slice-DoD's eight items are reachable from the dispatch sequence.
- ✓ Sequence is acyclic: D1's docs are inputs to D2's emit-site citations; D2's instrumented skill is what D3 exercises.

## Hand-off

Hand off to [`drive-build-workflow`](../../../../skills-contrib/drive-build-workflow/SKILL.md) to pilot the dispatch loop. Next dispatch: D2 (re-dispatch against canonical anchors).
