# Slice: 01-trace-vocab-and-build-instrumentation

_(Parent project [`projects/drive-instrumentation/`](../../spec.md); this slice satisfies the slice-1 outcomes named in [`plan.md`](../../plan.md) — trace event vocabulary, shared emission-protocol doc, `drive-build-workflow` instrumentation, orphan-slice / direct-change trace-path resolution, end-to-end demo of the emission loop.)_

Linear: [TML-2704](https://linear.app/prisma-company/issue/TML-2704/drive-instrumentation-s1-trace-event-vocabulary-drive-build-workflow).

> **Re-specified 2026-05-28** against the canonical `drive-build-workflow` structure in `skills-contrib/`. Prior version of this spec was authored against a stale `.agents/skills/` copy that pre-dated the factoring of brief-assembly + implementer-delegation into the sibling skill `drive-dispatch`. Section anchors and the instrumented file path are updated; vocabulary + emission protocol are unchanged (D1's commit `5bdc19013` survives intact). The transient `.agents/skills/`-vs-`skills-contrib/` drift was reconciled by wiping `.agents/skills/` and re-running `pnpm install`, so `.agents/skills/` is now regenerated from `skills-contrib/` at install time. The slice instruments the canonical body in `skills-contrib/`.

## At a glance

Ships the trace-event contract (vocabulary + emission protocol) and the first instrumented skill (`drive-build-workflow`), so that a Drive dispatch loop emits a structured `trace.jsonl` from which the rework metric (`rounds_per_dispatch`) and a narrow brief-churn metric can be computed by hand.

## Scope

### In scope

- **`docs/drive/trace-events.md`** — versioned event-vocabulary spec. Defines the common envelope, the five slice-1 event types, payload schemas, ordering and timestamp rules, and the vocabulary-version field. Cited from every instrumented skill. **Already shipped in D1 (`5bdc19013`); unchanged by the re-spec.**
- **`docs/drive/trace-emission.md`** — shared emission-protocol doc. Defines the trace-file path resolution (in-project / orphan-slice / direct-change), append-only JSONL conventions, the canonical "Emit" snippet skills paste into their workflow, and the file-write tool to use. Cited from every instrumented skill. **Already shipped in D1 (`5bdc19013`); unchanged by the re-spec.**
- **`skills-contrib/drive-build-workflow/SKILL.md` (edit)** — add "Emit" steps at five transition points (one per slice-1 event type) in the `## The per-dispatch loop` section. The emit instructions are terse (one line + a payload-field-list hint) and link to `docs/drive/trace-events.md` for the payload schema and `docs/drive/trace-emission.md` for the file-append mechanics. This is the canonical, tracked file; `.agents/skills/drive-build-workflow/SKILL.md` is regenerated from it at `pnpm install` time by the prepare hook (not edited directly).
- **`projects/drive-instrumentation/slices/01-trace-vocab-and-build-instrumentation/manual-qa.md`** — manual-QA script that exercises the instrumentation end-to-end on a small in-repo task and verifies `trace.jsonl` is produced + parsed correctly.
- **`projects/drive-instrumentation/slices/01-trace-vocab-and-build-instrumentation/qa-run-01.md`** — the first QA run report.

### Out of scope (this slice)

- Instrumenting `skills-contrib/drive-dispatch/SKILL.md` or any other drive-* skill (slice 2 owns the instrumentation sweep). Slice 1's 5-event spine is emitted entirely from `drive-build-workflow`. Direct-change brief tracking (which would require emitting `brief-issued` from `drive-dispatch`, since `drive-start-workflow` calls `drive-dispatch` for direct changes) is a slice-2 question.
- Event types beyond the five-event spine (DoR-check / DoD-check / artefact-write / artefact-read / phase-transition / escalation / retro-fired / operator-turn — slice 2).
- Any assertion library, diagnostic-metrics module, or report generator (slice 3).
- Post-hoc transcript parser for uninstrumented runs (slice 3).
- LLM judge, controlled-experiment harness, golden-case library (Project 2).
- Sub-agent-side emission (slice-1 emitters are orchestrator-side only; the orchestrator records `dispatch-start` / `dispatch-end` / `round-start` / `round-end` / `brief-issued` because it has the only legible vantage on dispatch and round boundaries). Sub-agent-internal events (heartbeats, intra-round artefact writes) are a slice-2 question.

## Approach

### Vocabulary shape

Unchanged from D1 — the vocabulary doc at `docs/drive/trace-events.md` was authored against the slice-plan-sense concept of "dispatch" (one M-sized unit in `plan.md`, may span multiple implementer/reviewer rounds), not the drive-dispatch-call-sense (one implementer delegation = one round). The 5 events are:

- `dispatch-start` / `dispatch-end` — slice-plan-sense unit lifecycle (fired once per dispatch).
- `round-start` / `round-end` — round lifecycle within a dispatch (one drive-dispatch call cycle + reviewer cycle).
- `brief-issued` — fires once per round, at the moment the orchestrator finalises the implementer brief and is about to call `drive-dispatch`.

For the full payload schemas, common envelope, JSONL examples, and arktype types, see [`docs/drive/trace-events.md`](/docs/drive/trace-events.md).

### Emission protocol

Unchanged from D1 — see [`docs/drive/trace-emission.md`](/docs/drive/trace-emission.md) for path resolution, append-only JSONL conventions, the canonical Emit snippet, and the Shell `>>` file-write mechanics.

### `drive-build-workflow` instrumentation (re-mapped to canonical anchors)

Five emit-sites land in `skills-contrib/drive-build-workflow/SKILL.md`. The canonical body's `## The per-dispatch loop` section has six numbered subsections; the emit-sites anchor inside them. Per-round temporal sequence (load-bearing — the implementer MUST follow this when placing the sites):

```
dispatch-start   (once per dispatch-unit, before round 1's DoR)
  round-start    (once per round, after DoR passes, before brief assembly)
  brief-issued   (once per round, after brief is assembled, immediately before calling drive-dispatch)
  <drive-dispatch handles implementer; returns done | blocked | stale>
  <WIP inspection, DoD, reviewer delegation, intent-validation, triage>
  round-end      (once per round, after triage records the verdict)
  [next round, if triage = ANOTHER ROUND NEEDED]
dispatch-end     (once per dispatch-unit, when triage = SATISFIED and no more dispatches remain in the slice, OR when an aborted / failed stop-condition fires)
```

Concretely, anchor each emit-site:

| Event | Anchor in `skills-contrib/drive-build-workflow/SKILL.md` | Cadence |
|---|---|---|
| `dispatch-start` | Top of `## The per-dispatch loop § 1 (Pre-flight: per-dispatch DoR)`, gated on "first round of this dispatch" (i.e. before the DoR walk on round 1; not re-emitted on round 2+). Document the once-per-dispatch contract inline. | Once per dispatch-unit. |
| `round-start` | End of `§ 1 (Pre-flight: per-dispatch DoR)`, after DoR passes and before `§ 2` begins. | Once per round. |
| `brief-issued` | End of `§ 2 (Dispatch the implementer (via drive-dispatch))`, immediately before the call to `drive-dispatch`. The brief is fully assembled at this point — the orchestrator has the brief object + the implementer subagent ID + carry-over in hand. | Once per round. |
| `round-end` | End of `§ 6 (Reviewer verdict + intent-validation + triage)`, after the triage verdict is recorded (regardless of which branch — SATISFIED / ANOTHER ROUND NEEDED / ESCALATING). The verdict goes into the event payload. | Once per round. |
| `dispatch-end` | In `§ 6`, on the branches that terminate the dispatch-unit: SATISFIED (with no more dispatches remaining in the slice → close-slice path) OR an aborted / failed stop-condition that ends the dispatch without a clean SATISFIED. Document the once-per-dispatch contract. | Once per dispatch-unit. |

Each emit-site is a 1–3-line "Emit" instruction. Suggested shape (adapt to fit the surrounding prose voice):

> **Emit `<event-type>`** — fields: `<list the orchestrator-known fields at this anchor, e.g. dispatch_id / round_id / verdict / wall_clock_ms>`. See [`docs/drive/trace-events.md`](/docs/drive/trace-events.md) for the payload schema and [`docs/drive/trace-emission.md`](/docs/drive/trace-emission.md) for the file-append mechanics.

The instrumentation is **additive only** — no existing prose in `drive-build-workflow/SKILL.md` is rewritten. The emit-site insertions add ~5–15 lines per site (~30–75 lines total). The existing per-dispatch-loop structure is the anchor; no section is restructured.

### Demo + manual QA

The slice closes by running `drive-build-workflow` against a small in-repo task and producing a `trace.jsonl`. Verification is structural (does the trace match the documented vocabulary?) and metric-computable (can `rounds_per_dispatch` + the narrow brief-churn metric be hand-computed?). See `manual-qa.md` for the seven QA checks.

Implementation note: because the orchestrator (the agent running drive-build-workflow at runtime) reads skills from `.agents/skills/` — which is now regenerated at `pnpm install` from `skills-contrib/` — the in-runtime instrumentation behaviour is identical regardless of which path you "edit." All edits go to `skills-contrib/` (the trackable canonical); `.agents/skills/` regenerates on next install. The QA run will use `.agents/skills/` at runtime but observes the same emit sequence the canonical defines.

## Edge cases (Example-Mapping)

| Edge case | Disposition | Notes |
|---|---|---|
| Two dispatches running concurrently (parallel subagents) | **Explicitly out** | `drive-build-workflow` is sequential per role per the loop algorithm. Vocabulary handles parallel correctly (unique `dispatch_id`) but slice 1 doesn't verify it. |
| Resumed persistent implementer subagent across slices | **Handle** | `dispatch-start.parent_dispatch_id` set to the prior dispatch_id for the same persistent implementer. Carries cross-slice continuity in the trace. |
| Stop-condition fires mid-dispatch (I12 halt to `drive-discussion`) | **Handle** | `round-end.verdict = "stop-condition"`; `dispatch-end.result = "aborted"`; `wall_clock_ms` recorded. |
| Brief is identical to a prior round's brief verbatim (reissue) | **Handle** | `brief-issued.brief_disposition = "reissue"`. Detected by same `brief_content_hash`. |
| Brief is amended between rounds | **Handle** | `brief-issued.brief_disposition = "amended"`. |
| Run-in-background subagent that completes asynchronously | **Handle** | `dispatch-end` / `round-end` fire when the orchestrator processes the completion notification, not at the subagent's internal wall-clock end. `wall_clock_ms` reflects orchestrator-observed elapsed. Subagent-internal vs orchestrator-observed delta is a slice-2 question. |
| Crash mid-emit (orchestrator killed between `dispatch-start` and `dispatch-end`) | **Explicitly out** | Trace is best-effort; partial trace files acceptable. No transactional guarantees. A `dispatch-start` without matching `dispatch-end` is a recognised diagnostic signal slice 3's assertion library can flag. |
| Trace file does not exist at first emit | **Handle** | First emit creates the file. Parent directory created too. Documented in `trace-emission.md`. |
| `wip/drive-trace/` does not exist for orphan-slice / direct-change emission | **Handle** | First emit creates the directory. Verified in QA. |
| Trace file lives in `projects/<slug>/trace.jsonl` and the project is closed via `drive-close-project` | **Explicitly out** | Close-out deletes `projects/<project>/`, including the trace. Durable methodology surfaces (vocab spec, emission protocol) migrate to `docs/` per close-out rules. If long-term run history is needed, that's a Project 2 concern. |
| Event payload has a field the schema doesn't define (forward-compat) | **Explicitly out** | Slice 1 ships v1 vocab. Forward-compat / migration is a future concern; instrumented skills emit exactly the documented payload, no extra fields. |
| Schema validation failure at emit time | **Handle** | Slice 1 does not validate at emit (per `trace-emission.md`). Bug-catching happens at read time in slice 3. If a slice-3 read-time validator fires on slice-1-emitted traces, that's a slice-1 defect to fix back. |
| Operator marker mid-run delimiting a new ProjectRun | **Defer** | Slice 1 hard-codes `project_run_id` per emission site. The detector (drive-skill-boundary primary; operator-marker fallback) is slice 3. |
| Operator amends `drive-build-workflow/SKILL.md` mid-slice | **Explicitly out** | Slice 1 instruments the current canonical state. Minor reword is tolerated (emit-sites anchor on intent, not line numbers). Major restructure → re-spec via `drive-discussion`. The 2026-05-28 reshape (factoring of `drive-dispatch`) was the canonical restructure that triggered this re-spec; further structural changes to drive-build-workflow during slice 1 execution would halt and surface. |
| Canonical-vs-presentation drift (`skills-contrib/` vs `.agents/skills/`) | **Handle (environmentally)** | `.agents/skills/` is regenerated from `skills-contrib/` at `pnpm install` time; treat `skills-contrib/` as the only authoritative editing path. Verified by `pnpm install` rerun before this slice's D2 dispatch. If the drift resurfaces during D2 / D3, halt and surface — the install hook may have a regression. |
| `drive-dispatch` becomes the primary emitter for `brief-issued` (cleanest emit-site location for direct-change briefs) | **Defer** | Slice 1 emits all five events from `drive-build-workflow` for simplicity and uniformity. Slice 2 may revisit if direct-change brief tracking becomes load-bearing. |
| Run-time skill body loaded by Cursor agent diverges from `skills-contrib/` (e.g. install hook not run; manual edits to `.agents/skills/`) | **Handle (out of band)** | Out of scope for slice 1 to enforce. The QA in D3 confirms the resolved instrumentation behaviour at runtime. If divergence is observed, halt and surface. |

## Slice Definition of Done

- [ ] **SDoD1.** All "Done when" gates from the slice plan pass (CI green; lint clean; typecheck clean — for any TS code touched; markdown lint where the team has it). For D1: passed (`5bdc19013`).
- [ ] **SDoD2.** Every pre-named edge case handled per disposition. New edge cases discovered during execution that aren't pre-named amend the spec via `drive-discussion` (per invariant I12).
- [ ] **SDoD3.** Reviewer verdict `SATISFIED` on `projects/drive-instrumentation/slices/01-trace-vocab-and-build-instrumentation/reviews/code-review.md`.
- [ ] **SDoD4.** Manual-QA script `manual-qa.md` exists; ≥ 1 QA run report `qa-run-01.md`; no unresolved 🛑 Blocker findings. Manual-QA is the load-bearing acceptance step for this slice because the instrumentation's correctness is observed by exercising the skill, not by unit tests.
- [ ] **SDoD5.** Slice doesn't touch surfaces listed as out-of-scope (no edits to `drive-dispatch` or other drive-* skills, no assertion / metric code, no judge / harness code, no edits to `.agents/skills/` — only `skills-contrib/`).
- [ ] **SDoD6.** `docs/drive/trace-events.md` and `docs/drive/trace-emission.md` exist, are versioned (`schema_version: "1"`), and are linked from the amended `skills-contrib/drive-build-workflow/SKILL.md`.
- [ ] **SDoD7.** Instrumented `drive-build-workflow` verified non-regressing against an uninstrumented baseline on a small in-repo task — the diff produced on the task is identical (or trivially differs only in the trace.jsonl side-effect).
- [ ] **SDoD8.** Trace.jsonl produced during QA is checked into the slice folder as `qa-trace-01.jsonl`.

## Open Questions

1. **The small in-repo task for the demo dispatch.** Working position: a one-line fix to a markdown file. The actual task is picked during D3.
2. **`orchestrator_agent_id` extraction.** Working position: emit `null` for slice 1. If Cursor's SDK / IDE / env exposes the agent UUID via a standard read, populate. If not, leave for Project 2.
3. **Should `brief-issued` fire for the reviewer delegation as well as the implementer one?** Working position: slice 1 only fires `brief-issued` for the implementer brief (the rework metric reads from it). The reviewer delegation in `drive-build-workflow § 5` is a separate, smaller delegation; a `review-brief-issued` event type can be added in slice 2 if needed.
4. **Vocabulary-doc location.** Settled at `docs/drive/trace-events.md` + `docs/drive/trace-emission.md` (D1 ship). No change.
5. **ADR for the trace-emission protocol.** Forward-referenced in `trace-emission.md`. Working position: commit to writing an ADR at project close-out. If the operator wants it earlier, slice 3 carries it.
6. **(New)** **Direct-change brief tracking.** `drive-start-workflow` calls `drive-dispatch` for direct-change verdicts; that path doesn't go through `drive-build-workflow` and so produces no `brief-issued` event under slice 1's instrumentation. Working position: out of scope for slice 1; revisit in slice 2 (likely by also emitting `brief-issued` from `drive-dispatch § 1 (validate the brief)`, which would capture both slice-loop and direct-change briefs).

## References

- Parent project spec: [`projects/drive-instrumentation/spec.md`](../../spec.md).
- Parent project plan: [`projects/drive-instrumentation/plan.md`](../../plan.md).
- Parent project design notes: [`projects/drive-instrumentation/design-notes.md`](../../design-notes.md) — § D5 settled JSONL-to-file emission; § D6 settled the five-event spine.
- Linear issue: [TML-2704](https://linear.app/prisma-company/issue/TML-2704/drive-instrumentation-s1-trace-event-vocabulary-drive-build-workflow).
- Originating ticket: [TML-2703](https://linear.app/prisma-company/issue/TML-2703/plan-drive-instrumentation).
- Drive principle docs referenced by the vocabulary: [`docs/drive/principles/sizing.md`](/docs/drive/principles/sizing.md), [`docs/drive/principles/brief-discipline.md`](/docs/drive/principles/brief-discipline.md).
- Drive skill being instrumented: [`skills-contrib/drive-build-workflow/SKILL.md`](/skills-contrib/drive-build-workflow/SKILL.md). The sibling skill `skills-contrib/drive-dispatch/SKILL.md` is referenced for context only — not instrumented this slice.
- D1 commit: `5bdc19013` (shipped `docs/drive/trace-events.md` + `docs/drive/trace-emission.md`).
