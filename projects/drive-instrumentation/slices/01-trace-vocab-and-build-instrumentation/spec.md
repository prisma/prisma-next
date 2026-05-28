# Slice: 01-trace-vocab-and-build-instrumentation

_(Parent project [`projects/drive-instrumentation/`](../../spec.md); this slice satisfies the slice-1 outcomes named in [`plan.md`](../../plan.md) — trace event vocabulary, shared emission-protocol doc, `drive-build-workflow` instrumentation, orphan-slice / direct-change trace-path resolution, end-to-end demo of the emission loop.)_

Linear: [TML-2704](https://linear.app/prisma-company/issue/TML-2704/drive-instrumentation-s1-trace-event-vocabulary-drive-build-workflow).

## At a glance

Ships the trace-event contract (vocabulary + emission protocol) and the first instrumented skill (`drive-build-workflow`), so that a Drive dispatch loop emits a structured `trace.jsonl` from which the rework metric (`rounds_per_dispatch`) and a narrow brief-churn metric can be computed by hand.

## Scope

### In scope

- **`docs/drive/trace-events.md` (new)** — versioned event-vocabulary spec. Defines the common envelope, the five slice-1 event types, payload schemas, ordering and timestamp rules, and the vocabulary-version field. Cited from every instrumented skill.
- **`docs/drive/trace-emission.md` (new)** — shared emission-protocol doc. Defines the trace-file path resolution (in-project / orphan-slice / direct-change), append-only JSONL conventions, the canonical "Emit" snippet skills paste into their workflow, and the file-write tool to use. Cited from every instrumented skill.
- **`.agents/skills/drive-build-workflow/SKILL.md` (edit)** — add "Emit" steps at five transition points (one per slice-1 event type). The emit instructions are terse (one line + a payload-table reference) and link to `docs/drive/trace-emission.md`.
- **`projects/drive-instrumentation/slices/01-trace-vocab-and-build-instrumentation/manual-qa.md` (new)** — manual-QA script that exercises the instrumentation end-to-end on a small in-repo task and verifies `trace.jsonl` is produced + parsed correctly.
- **`projects/drive-instrumentation/slices/01-trace-vocab-and-build-instrumentation/qa-run-01.md` (new)** — the first QA run report.

### Out of scope (this slice)

- Other `drive-*` skills (slice 2 owns the instrumentation sweep).
- Event types beyond the five-event spine (DoR-check / DoD-check / artefact-write / artefact-read / phase-transition / escalation / retro-fired / operator-turn — slice 2).
- Any assertion library, diagnostic-metrics module, or report generator (slice 3).
- Post-hoc transcript parser for uninstrumented runs (slice 3).
- LLM judge, controlled-experiment harness, golden-case library (Project 2).
- Sub-agent-side emission (slice-1 emitters are orchestrator-side only; the orchestrator records `dispatch-start` / `dispatch-end` / `round-start` / `round-end` / `brief-issued` because it has the only legible vantage on dispatch and round boundaries). Sub-agent-internal events (heartbeats, intra-round artefact writes) are a slice-2 question.

## Approach

### Vocabulary shape

Every event is a single JSON object on its own line in `trace.jsonl`. Events share a common envelope; each event type adds its own payload fields.

**Common envelope** (every event):

| Field | Type | Meaning |
|---|---|---|
| `event_id` | UUID v4 | Unique per event; assigned at emit time. |
| `event_type` | string | One of the documented event-type names (slice 1: `dispatch-start`, `dispatch-end`, `round-start`, `round-end`, `brief-issued`). |
| `schema_version` | string | Vocabulary version. Slice 1 ships `"1"`. |
| `ts` | ISO 8601 UTC string | Wall-clock at emit time. Events are not guaranteed monotonic across re-entrant skills; order in file = canonical order. |
| `project_run_id` | string | Stable identifier for the ProjectRun this event belongs to. Format: project slug for in-project work (e.g. `drive-instrumentation`); `orphan-<slice-slug>` for orphan slices; `direct-<ISO-ts>` for direct changes. Detection follows the parent project spec's `detection_method` field (drive-skill-boundary primary; operator-marker fallback). Slice 1 does not yet implement the detector — the orchestrator hard-codes `project_run_id` per emission site based on its current project context. |
| `orchestrator_agent_id` | string \| null | Cursor session UUID (best-effort, from environment / SDK). Slice 1 emits `null` when not knowable from inside the skill body. |

**Slice-1 event types** (payload-only; envelope omitted):

- `dispatch-start`
  - `dispatch_id` (UUID v4) — new per dispatch; referenced by every following event in this dispatch.
  - `dispatch_name` (string) — operator-authored short descriptor (e.g. `"implementer m3 R2"`).
  - `subagent_type` (string) — Cursor `Task` `subagent_type` field passed through verbatim.
  - `model` (string \| null) — model name passed to `Task`; null when unspecified.
  - `parent_dispatch_id` (UUID \| null) — when the dispatch resumes a prior subagent (e.g. round 2 of an existing dispatch), points to that dispatch's `dispatch_id`. When resuming a *cross-slice* persistent subagent (per `drive-build-workflow § Subagent continuity`), points to the most recent prior dispatch ID for that subagent.

- `dispatch-end`
  - `dispatch_id` (UUID) — same `dispatch_id` as the corresponding `dispatch-start`.
  - `result` (enum: `"completed"` \| `"failed"` \| `"aborted"`) — `completed` = subagent returned with the work delegation finished (regardless of reviewer verdict — that's `round-end`); `failed` = subagent surfaced a stop condition; `aborted` = orchestrator killed the dispatch (e.g. WIP-inspection drift).
  - `wall_clock_ms` (integer) — milliseconds between `dispatch-start.ts` and this event's `ts`.

- `round-start`
  - `dispatch_id` (UUID) — the enclosing dispatch.
  - `round_id` (UUID v4) — new per round; referenced by `round-end` and by `brief-issued` for this round.
  - `round_number` (integer, 1-indexed) — sequential within `dispatch_id`. Slice 1 instrumentation treats each implementer→reviewer→triage cycle as one round.

- `round-end`
  - `dispatch_id` (UUID) — same as the enclosing `dispatch-start`.
  - `round_id` (UUID) — same as the corresponding `round-start`.
  - `verdict` (enum: `"satisfied"` \| `"another-round-needed"` \| `"escalating-to-user"` \| `"stop-condition"`) — reviewer's verdict per `drive-build-workflow § Loop algorithm step 7`. `"stop-condition"` handles the I12 halt-and-route-to-discussion case where review didn't issue a verdict.
  - `findings_filed` (integer) — count of new findings filed in `code-review.md § Findings log` this round (best-effort: orchestrator-side observation).
  - `wall_clock_ms` (integer) — milliseconds between `round-start.ts` and this event's `ts`.

- `brief-issued`
  - `dispatch_id` (UUID) — the enclosing dispatch.
  - `round_id` (UUID) — the round whose delegation this brief feeds. Brief-issued fires once per round (for the implementer delegation; reviewer delegations get a future event type in slice 2 if needed — for slice 1 only the implementer brief is tracked, because the rework metric reads from it).
  - `brief_byte_length` (integer) — UTF-8 byte length of the assembled brief.
  - `brief_content_hash` (string, sha256 hex) — hash of the assembled brief. Lets cross-round diffs identify whether a brief was re-issued verbatim vs amended.
  - `brief_disposition` (enum: `"initial"` \| `"reissue"` \| `"amended"`) — `initial` = first brief for this dispatch; `reissue` = same hash as a prior brief in this dispatch; `amended` = different hash from prior briefs in this dispatch.

### Emission protocol

`docs/drive/trace-emission.md` ships the shared "how to emit" doc the instrumented skills cite. Its load-bearing rules:

- **File path.** Resolved at orchestrator startup per current project context:
  - In-project: `projects/<project-slug>/trace.jsonl`.
  - Orphan slice (no parent project): `wip/drive-trace/orphan-<slice-slug>.jsonl`.
  - Direct change: `wip/drive-trace/direct-<ISO-timestamp>.jsonl`.
  - `wip/drive-trace/` is gitignored (per `wip/` existing rule); no project-scope leak.
- **File format.** Append-only JSONL. One event per line. No nested arrays. UTF-8 strict.
- **Concurrency.** The orchestrator is single-writer per trace file (sub-agents do not write). Slice 1 does not add a lock; the orchestrator's natural sequence of tool calls already serialises writes.
- **Schema validation.** Event payloads are validated at emit time against arktype schemas defined in `docs/drive/trace-events.md` (the doc carries the type definitions verbatim; instrumented skills do not parse-validate at emit — they trust the orchestrator to construct conformant payloads. Validation is a slice-3 deliverable on read, not slice-1 on write).
- **Emit step.** Each instrumented skill embeds a one-line "Emit" instruction at each transition point. The instruction names the event type + the payload fields the orchestrator must compute + a link to `docs/drive/trace-emission.md § Append protocol` for the actual file-append mechanics. The intent is that the instrumented skill body grows by ~5 lines per event type, not by a copy of the protocol.

### `drive-build-workflow` instrumentation

Five emit-sites land in the skill body, threaded into the existing per-dispatch protocol structure:

| Skill body anchor | Event type | When |
|---|---|---|
| § Per-dispatch protocol § 2 (brief assembly), before the `delegate-implement.md` Task call | `dispatch-start` | Once per dispatch (orchestrator pre-delegation). |
| § Per-dispatch protocol § 2 (brief assembly), as the last step before the Task call | `brief-issued` | Once per round (when the brief is finalised). |
| § Loop algorithm step 2 (delegate implementation), immediately after the implementer Task call resolves | `round-start` is emitted **before** delegate-implement, not after. Correction: `round-start` fires once the round is "opened" by the orchestrator's intent-to-dispatch — concretely, after DoR passes (§ Per-dispatch protocol § 1) but before brief assembly. | (Pre-delegation.) |
| § Loop algorithm step 7 (intent-validation + triage), after triage resolves | `round-end` | Once per round, after the orchestrator's triage verdict is recorded. |
| § Loop algorithm step 8 (triage verdict), when the verdict is `SATISFIED` AND no further dispatches remain in the slice, OR when an `aborted` / `failed` stop condition fires | `dispatch-end` | Once per dispatch. |

(The table above has one self-correction baked in: `round-start` fires after DoR but before brief assembly, so the temporal sequence per round is `round-start → brief-issued → delegate Task call → round-end`. The corrected sequence is documented inline in the skill body's instrumentation patch.)

### Demo + manual QA

The slice closes by running `drive-build-workflow` against a small in-repo task (TBD during dispatch — e.g. a typo fix or a one-line skill amendment that doesn't itself need instrumentation) and producing a `trace.jsonl`. The QA script verifies:

1. The file is created at the resolved path.
2. Every line parses as JSON.
3. Each emitted event matches the documented payload shape.
4. The five event types appear at least once.
5. `rounds_per_dispatch` (count of `round-end` events grouped by `dispatch_id`) is computable by hand.
6. The narrow brief-churn metric (sum of `brief-issued.brief_byte_length` per dispatch / max `brief-issued.brief_byte_length` per dispatch) is computable by hand.
7. The instrumented `drive-build-workflow` produces the same diff (on the small in-repo task) as an uninstrumented baseline run — the instrumentation does not change behaviour.

The QA run report records pass/fail per check.

## Edge cases (Example-Mapping)

| Edge case | Disposition | Notes |
|---|---|---|
| Two dispatches running concurrently (parallel subagents) | **Explicitly out** | `drive-build-workflow` is sequential per role (§ Multitasking the loop — "the loop is sequential per role"). The instrumentation does not need to handle two `dispatch-start` events overlapping. If parallel role dispatches become a real shape in the future, the vocabulary handles it correctly (dispatch_id is unique per dispatch) but slice 1 doesn't verify it. |
| Resumed persistent subagent across slices | **Handle** | `dispatch-start.parent_dispatch_id` set to the prior dispatch ID for the same persistent subagent. Carries cross-slice continuity in the trace. |
| Stop-condition fires mid-dispatch (I12 halt to `drive-discussion`) | **Handle** | `round-end.verdict = "stop-condition"`; `dispatch-end.result = "aborted"`; `wall_clock_ms` recorded. |
| Brief is identical to a prior round's brief verbatim (reissue) | **Handle** | `brief-issued.brief_disposition = "reissue"`. Detected by same `brief_content_hash`. |
| Brief is amended between rounds | **Handle** | `brief-issued.brief_disposition = "amended"`. |
| Run-in-background subagent that completes asynchronously | **Handle** | `dispatch-end` fires when the orchestrator processes the completion notification, not when the subagent finishes wall-clock. The `wall_clock_ms` reflects the time the orchestrator was aware of the dispatch; the difference between subagent-internal wall-clock and orchestrator-observed wall-clock is a slice-2 question. |
| Crash mid-emit (e.g. orchestrator killed between `dispatch-start` and `dispatch-end`) | **Explicitly out** | The trace is best-effort; partial trace files are acceptable. No transactional guarantees. A `dispatch-start` without a matching `dispatch-end` is a recognised diagnostic signal slice 3's assertion library can flag. |
| Trace file does not exist at first emit (initial run for a new project) | **Handle** | First emit creates the file. The directory is also created if missing (mkdir -p semantics). |
| `wip/drive-trace/` directory does not exist for orphan-slice / direct-change emission | **Handle** | First emit creates the directory. Verified in QA. |
| Trace file lives in `projects/<slug>/trace.jsonl` and the project is closed via `drive-close-project` | **Explicitly out** | Close-out's "delete `projects/<project>/`" deletes the trace too. The trace is a transient run-time artefact; durable methodology surfaces (vocab spec, emission protocol) migrate to `docs/` per the close-out rules. If long-term run history is needed, that's a Project 2 concern (the live harness writes to a longer-lived path). |
| Event payload has a field the schema doesn't define (forward-compat) | **Explicitly out** | Slice 1 ships v1 vocab. Forward-compat / migration is a future concern; instrumented skills emit exactly the documented payload, no extra fields. |
| Schema validation failure at emit time | **Handle** | Slice 1 does not validate at emit (per § Emission protocol § Schema validation). The skill body's emit step constructs the payload from the orchestrator's known state; any payload bug is caught at read time in slice 3. If a slice-3 read-time validator fires on slice-1-emitted traces, that's a slice-1 defect to fix back. |
| Operator marker mid-run that delimits a new ProjectRun (per parent spec § ProjectRun delimiters) | **Defer** | Slice 1 hard-codes `project_run_id` per emission site. The detector (drive-skill-boundary primary; operator-marker fallback) is slice 3. |
| Operator amends `drive-build-workflow` skill body mid-slice (e.g. changes a step's wording) | **Explicitly out** | Slice 1 instruments the current state of the skill body. If the operator amends the skill mid-slice, the slice resumes against the amended body — instrumentation emit-sites are anchored on intent (per the per-dispatch protocol structure), not on line numbers, so minor reword is tolerated. Major restructure may require a slice-1 re-spec via `drive-discussion`. |
| The same trace.jsonl is read by a future slice-3 assertion while slice 1 is still being executed | **Explicitly out** | Slice 3 doesn't exist yet. The vocab is forward-compatible by design (`schema_version` field). |

## Slice Definition of Done

- [ ] **SDoD1.** All "Done when" gates from the slice plan pass (CI green; lint clean; typecheck clean — for any TS code touched; markdown lint where the team has it).
- [ ] **SDoD2.** Every pre-named edge case in this spec is handled per its disposition. New edge cases discovered during execution that aren't pre-named amend the spec via `drive-discussion` (per invariant I12).
- [ ] **SDoD3.** Reviewer verdict `SATISFIED` on `projects/drive-instrumentation/slices/01-trace-vocab-and-build-instrumentation/reviews/code-review.md`.
- [ ] **SDoD4.** Manual-QA script `manual-qa.md` exists; ≥ 1 QA run report `qa-run-01.md`; no unresolved 🛑 Blocker findings. Manual-QA is the load-bearing acceptance step for this slice because the instrumentation's correctness is observed by exercising the skill, not by unit tests.
- [ ] **SDoD5.** Slice doesn't touch surfaces listed as out-of-scope (no edits to other drive-* skills, no assertion / metric code, no judge / harness code).
- [ ] **SDoD6.** `docs/drive/trace-events.md` and `docs/drive/trace-emission.md` exist, are versioned (`schema_version: "1"`), and are linked from the amended `drive-build-workflow` skill body.
- [ ] **SDoD7.** Instrumented `drive-build-workflow` verified non-regressing against an uninstrumented baseline on a small in-repo task — the diff produced on the task is identical (or trivially differs only in the trace.jsonl side-effect).
- [ ] **SDoD8.** Trace.jsonl produced during QA is checked into the slice folder as `qa-trace-01.jsonl` (gitignored at the canonical run paths; copied into the slice folder as evidence).

## Open Questions

1. **The small in-repo task for the demo dispatch.** Working position: a one-line fix to a markdown file (e.g. correcting an existing rule or skill body typo). Picking a real task that doesn't itself need instrumentation lets the demo verify behaviour-preservation alongside instrumentation correctness. The actual task is picked during dispatch.
2. **`orchestrator_agent_id` extraction.** Working position: emit `null` for slice 1. Cursor's SDK / IDE may expose the agent UUID at runtime; if it's reachable from inside a skill body via a standard tool call or env var, populate. If not reachable, leave for slice 2 / Project 2 to plumb.
3. **Should `brief-issued` fire for the reviewer delegation as well as the implementer one?** Working position: slice 1 only fires `brief-issued` for the implementer brief (the rework metric reads from it). If a reviewer-brief metric emerges as load-bearing, add a `review-brief-issued` event type in slice 2 rather than overloading `brief-issued`.
4. **Vocabulary-doc location.** Working position: `docs/drive/trace-events.md` + `docs/drive/trace-emission.md`. These are durable methodology surfaces; they belong in `docs/drive/` per the team's documentation conventions. If the team prefers `docs/architecture docs/` (per the architecture-docs rule), surface during dispatch and move.
5. **ADR for the trace-emission protocol.** The team's spec convention requires an ADR pointer for any architectural shift (per `drive/spec/README.md § Required sections`). The trace-emission protocol arguably qualifies. Working position: commit to writing an ADR at project close-out; reference forward in `docs/drive/trace-emission.md`. If the reviewer / operator wants the ADR earlier, slice 3 carries it.

## References

- Parent project spec: [`projects/drive-instrumentation/spec.md`](../../spec.md).
- Parent project plan: [`projects/drive-instrumentation/plan.md`](../../plan.md).
- Parent project design notes: [`projects/drive-instrumentation/design-notes.md`](../../design-notes.md) — § D5 settled JSONL-to-file emission; § D6 settled the five-event spine.
- Linear issue: [TML-2704](https://linear.app/prisma-company/issue/TML-2704/drive-instrumentation-s1-trace-event-vocabulary-drive-build-workflow).
- Originating ticket: [TML-2703](https://linear.app/prisma-company/issue/TML-2703/plan-drive-instrumentation).
- Drive principle docs referenced by the vocabulary: [`docs/drive/principles/sizing.md`](/docs/drive/principles/sizing.md) (M-cap at dispatch), [`docs/drive/principles/brief-discipline.md`](/docs/drive/principles/brief-discipline.md) (brief shape; one round's brief).
- Drive skill being instrumented: [`.agents/skills/drive-build-workflow/SKILL.md`](/.agents/skills/drive-build-workflow/SKILL.md).
