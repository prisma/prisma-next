# Slice plan: 01-trace-vocab-and-build-instrumentation

Three dispatches, strictly sequential. Each is M-sized; no L/XL.

Slice spec: [`spec.md`](./spec.md).

## Failure modes threaded into briefs

Each dispatch's brief threads the applicable entries from [`drive/calibration/failure-modes.md`](../../../../drive/calibration/failure-modes.md):

- **F5 (destructive git ops by subagents)** — non-negotiable, threaded into every dispatch's brief edge-case table per the team's slice-DoR overlay.
- **F4 (feature-sized dispatch with no inspection cadence)** — Dispatch 2 is the most-at-risk (skill-body instrumentation that could spread). WIP-inspection cadence at the midpoint enforced.
- **F3 (discovery via test suite vs grep)** — Dispatch 3's verification could fall into "re-run drive-build-workflow to discover what's broken" if the instrumentation is wrong. Threaded into D3 with a pre-computed checklist of what to read from the trace.

Not directly applicable to slice 1's shape: F1, F2, F6 (orchestrator-side, not subagent-side), F7 (same), F8, F9 (no structured-file grep gates in this slice).

Scope traps from [`drive/calibration/failure-modes.md § Slice-shape scope traps`](../../../../drive/calibration/failure-modes.md#slice-shape-scope-traps) do not apply directly — slice 1 is well-scoped (two new docs + one skill-body edit + verification artefacts). The most plausible scope creep is "while I'm here, instrument one more drive-* skill" — explicitly out per slice spec § Out of scope.

## Grep gates

No entries from [`drive/calibration/grep-library.md`](../../../../drive/calibration/grep-library.md) directly apply to this slice's shape — slice 1 doesn't introduce any cross-codebase anti-pattern to grep for. The verification path is "read the produced trace.jsonl," not "grep the codebase."

## Dispatches

### Dispatch 1: Vocabulary + emission-protocol docs

**Intent.** Write the two canonical methodology docs the rest of the slice (and subsequent slices) references: `docs/drive/trace-events.md` (the event vocabulary with envelope + slice-1 event payloads + arktype schemas) and `docs/drive/trace-emission.md` (the emission protocol with file-path resolution, append rules, the canonical "Emit" snippet, and the `wip/drive-trace/` orphan/direct-change path). Both files derive directly from `spec.md § Approach` — minimal interpretation, mostly translation from spec to doc.

**Files in play.**

- `docs/drive/trace-events.md` (new).
- `docs/drive/trace-emission.md` (new).

**"Done when":**

- [ ] Both files exist at the named paths.
- [ ] `trace-events.md` carries: vocabulary version (`schema_version: "1"`), common envelope table, payload schema for each of the five event types (`dispatch-start`, `dispatch-end`, `round-start`, `round-end`, `brief-issued`), arktype type definitions matching the documented payload, examples of each event-type in JSONL form.
- [ ] `trace-emission.md` carries: trace-file-path resolution rules (in-project / orphan-slice / direct-change), append-only JSONL conventions, the canonical "Emit" snippet a skill body can paste-by-reference, the file-write tool to use (StrReplace append / shell append — implementer picks the more reliable one and documents the choice).
- [ ] `wip/drive-trace/` is added to `.gitignore` if not already covered by the existing `wip/` rule (verify; do not duplicate).
- [ ] Markdown lint clean on both new files (whatever the team's markdown lint is — implementer infers from existing docs/drive/ markdown style if no explicit lint config).
- [ ] Intent-validation: diff is strictly limited to the two new files + an optional `.gitignore` line; no other files touched.
- [ ] Edge cases (from slice spec) covered: trace-file-path-on-first-emit (file + parent dir created on first append; documented in emission-protocol); schema version field present (handled by `schema_version: "1"` in envelope); orphan / direct-change paths defined.

**Size.** M (~1.5h estimated).

**DoR confirmed:** ✓ — intent clear, files-in-play named, "done when" binary, size M, F5 + F4 considered (F5 threaded; F4 not relevant — docs-only dispatch with no spread risk), no silent design decisions (the vocab + protocol design is fully settled in `spec.md`).

---

### Dispatch 2: Instrument drive-build-workflow

**Intent.** Add five "Emit" steps to `.agents/skills/drive-build-workflow/SKILL.md`, one per slice-1 event type, at the anchors named in `spec.md § Approach § drive-build-workflow instrumentation`. Each emit step is a one-line instruction referencing `docs/drive/trace-emission.md § Append protocol` for the file-append mechanics, plus a payload-table reference to `docs/drive/trace-events.md` for the event's expected fields. The skill body grows by ~5-15 lines total; the existing per-dispatch-protocol structure is the anchor — no restructuring.

**Files in play.**

- `.agents/skills/drive-build-workflow/SKILL.md` (edit).

**"Done when":**

- [ ] Five emit-sites land in the skill body, at the anchors named in `spec.md § Approach § drive-build-workflow instrumentation`. The corrected per-round temporal sequence (`round-start → brief-issued → delegate → round-end`) is reflected in where the emit sites sit in the skill body.
- [ ] Each emit-site cites `docs/drive/trace-emission.md` and `docs/drive/trace-events.md`.
- [ ] No other section of the skill body is materially changed (the implementer can fix typos / formatting touched incidentally but cannot alter workflow semantics).
- [ ] Behaviour-preservation check: the implementer reads the skill body before and after the patch and confirms — in their report — that the workflow's semantic behaviour is unchanged. The emit steps are *additions*, not edits to existing steps. (Spot-running the workflow is Dispatch 3's job; this dispatch's intent-validation is a reading-level check.)
- [ ] Markdown lint clean.
- [ ] Intent-validation: diff strictly limited to the named skill file; no other drive-* skills touched (F4-style spread prevention).
- [ ] Edge cases (from slice spec) covered: "Operator amends drive-build-workflow skill body mid-slice" — explicitly out-of-scope, but if a structural change is required to land the emit-sites cleanly (e.g. the cited anchor doesn't actually exist in the skill body anymore), halt-and-surface to the orchestrator rather than improvising.

**Size.** M (~1.5-2h estimated).

**DoR confirmed:** ✓ — intent clear, file named, "done when" binary, size M (no spread to other skills, M-capped), F4 + F5 threaded, the cited anchors in `spec.md § Approach` are concrete locations the implementer can find by Read on the skill body. No silent design decisions — the emit-site placement table in `spec.md` pins each event's anchor.

**WIP-inspection cadence** (per F4 mitigation): one inspection at the implementer's first heartbeat after starting the file edit, OR at ~30 min in if no heartbeat fired. The inspection reads the diff to confirm scope is still strictly the named skill file.

---

### Dispatch 3: Manual-QA script + first run

**Intent.** Author `manual-qa.md` (the QA script that exercises the instrumented `drive-build-workflow` end-to-end on a small in-repo task) and execute one run end-to-end, producing `qa-run-01.md` (the run report) + `qa-trace-01.jsonl` (the emitted trace as evidence). The run does not need to be a full real-agent dispatch loop — a walkthrough where the implementer simulates the orchestrator's emit decisions at each anchor in the instrumented skill body and writes the expected JSONL is acceptable. The verification is structural (does the trace match the documented vocabulary?) plus metric-computable (can `rounds_per_dispatch` and the narrow brief-churn metric be computed by hand from the trace?).

**Files in play.**

- `projects/drive-instrumentation/slices/01-trace-vocab-and-build-instrumentation/manual-qa.md` (new).
- `projects/drive-instrumentation/slices/01-trace-vocab-and-build-instrumentation/qa-run-01.md` (new).
- `projects/drive-instrumentation/slices/01-trace-vocab-and-build-instrumentation/qa-trace-01.jsonl` (new — committed as evidence even though canonical run paths are gitignored).

**"Done when":**

- [ ] `manual-qa.md` exists, describes the seven QA checks named in `spec.md § Approach § Demo + manual QA`, and is structured as a re-runnable checklist (re-runnable: the next QA pass can pick it up cold without context).
- [ ] `qa-run-01.md` records the run: date, the small in-repo task chosen for the demo, observations against each of the seven QA checks, pass/fail per check, and a "no unresolved 🛑 Blocker findings" status line at the end.
- [ ] `qa-trace-01.jsonl` exists, contains at least one event of each of the five slice-1 event types, every line parses as JSON, every event matches the documented payload shape from `docs/drive/trace-events.md`.
- [ ] `rounds_per_dispatch` (count of `round-end` events grouped by `dispatch_id`) is shown computed by hand in `qa-run-01.md` for at least one dispatch in the trace.
- [ ] Brief-churn narrow metric (sum of `brief-issued.brief_byte_length` per dispatch / max `brief-issued.brief_byte_length` per dispatch) is shown computed by hand in `qa-run-01.md`.
- [ ] Behaviour-preservation check (carried over from D2): the diff produced on the small in-repo task by the instrumented `drive-build-workflow` walkthrough matches what an uninstrumented walkthrough would produce. Recorded in `qa-run-01.md`.
- [ ] Intent-validation: diff strictly limited to the three new files in the slice folder; no other files touched.
- [ ] No silent design decisions — if the implementer hits a fork during walkthrough simulation (e.g. "which task is the small in-repo task?"), surface to orchestrator rather than picking unilaterally.
- [ ] Edge cases (from slice spec) covered: trace-file-on-first-emit (verified in the run); each event-type schema is exercised; the seven QA checks together cover the load-bearing slice spec edge cases that aren't structurally out-of-scope.

**Size.** M (~1.5-2h estimated, dominated by the walkthrough execution).

**DoR confirmed:** ✓ — intent clear, files named, "done when" binary, size M, F3 + F5 threaded (F3: do not re-run drive-build-workflow as a discovery mechanism; the implementer reads the instrumented skill body once + simulates each emit). The "small in-repo task" choice is a spec § Open Questions item that the implementer surfaces during dispatch rather than picking unilaterally.

**WIP-inspection cadence** (per F4 mitigation): one inspection mid-walkthrough — read the partial qa-trace-01.jsonl + the partial qa-run-01.md to confirm structural coherence before the dispatch completes.

---

## Sanity checks

- ✓ Each dispatch sized M (none L/XL).
- ✓ Each dispatch's "done when" is binary + verifiable on disk.
- ✓ Every slice-spec edge case is either covered by a dispatch's "done when" or explicitly out-of-scope in the spec.
- ✓ Slice-DoD's eight items are reachable from the dispatch sequence: SDoD1 (CI green) via D1+D2+D3's lint/markdown gates; SDoD2 (edge cases handled per disposition) via each dispatch's edge-case coverage; SDoD3 (reviewer SATISFIED) via the reviewer's per-dispatch verdicts; SDoD4 (manual-QA + run report) via D3; SDoD5 (no out-of-scope surface touched) via each dispatch's intent-validation; SDoD6 (vocab + protocol docs exist + linked) via D1+D2; SDoD7 (instrumentation non-regressing) via D2's reading check + D3's run-evidence check; SDoD8 (qa-trace-01.jsonl committed) via D3.
- ✓ Sequence is acyclic: D1 outputs the docs D2 references; D2's instrumented skill is what D3 exercises.

## Hand-off

Hand off to [`drive-build-workflow`](../../../../.agents/skills/drive-build-workflow/SKILL.md) to pilot the dispatch loop. Starting dispatch: D1.
