# Slice: 02-lifecycle-cadence-and-direct-change

_(Parent project [`projects/drive-instrumentation/`](../../spec.md); this slice satisfies the slice-2 outcomes named in [`plan.md`](../../plan.md) — instrument the remaining in-scope lifecycle / cadence skills and close the direct-change emission gap, so a trace captures the complete project run shape rather than just the build loop + planning chain.)_

Linear: [TML-2711](https://linear.app/prisma-company/issue/TML-2711/drive-instrumentation-s2-lifecycle-cadence-and-direct-change-gap).

## At a glance

Extends the slice-1 trace contract with the project run's outer skeleton: project + slice lifecycle bookends, health-check cadence firings, retro firings, and — the load-bearing gap — **direct-change work**, which today passes through `drive-start-workflow → drive-dispatch` and emits nothing. After this slice, a Drive run produces a `trace.jsonl` from which these additional signals are hand-computable:

- **Project wall-clock** (`project-closed.ts − project-started.ts`) and **slice wall-clock** (`slice-completed.ts − slice-started.ts`) — the outer-loop time the build-loop spine sits inside.
- **Cadence health** (`health-check-fired` count + cadence distribution + drift-signal counts) — how often the project drifted and at which cadence it was caught.
- **Retro frequency + landing** (`retro-landed` count + trigger-class distribution + landing-surface distribution) — whether lessons actually land in a memory-strong surface.
- **Direct-change visibility** (a full `dispatch-start … dispatch-end` spine for one-shot direct changes) — direct-change PRs stop being a blind spot; their rework / brief / wall-clock join the same metrics as build-loop dispatches.

## Chosen design

**Six new event types** carry the lifecycle + cadence skeleton; the **direct-change gap is closed by reusing the slice-1 build-loop spine** (no new event types) at new emit-sites in `drive-start-workflow`.

### New event types

| Event | Emitted by | Fires |
|---|---|---|
| `project-started` | `drive-create-project` | once, after the project workspace is scaffolded |
| `project-closed` | `drive-close-project` | once, at the terminal close-out step (close-out PR opened) |
| `slice-started` | `drive-deliver-workflow` | once per slice, before `drive-build-workflow` runs the slice |
| `slice-completed` | `drive-deliver-workflow` | once per slice, after the slice PR merges |
| `health-check-fired` | `drive-check-health` | once per rollup, after the rollup renders |
| `retro-landed` | `drive-run-retro` | once per retro, after the retro entry lands |

Payload sketches (precise arktype schemas finalised in D1):

- **`project-started`** — `project_slug`, `origin` (`"new-project"` | `"promote"`), `has_linear_project` (bool). `project_run_id` equals `project_slug`.
- **`project-closed`** — `dod_status` (`"all-met"` | `"some-deferred"` | `"some-cancelled"`), `slices_completed` (int), `final_retro_done` (bool). Project-level wall-clock is **read-side** (computed from the `project-started`/`project-closed` `ts` pair in the trace file); not emitted, because the two events routinely span sessions and the orchestrator does not hold `project-started.ts` at close time.
- **`slice-started`** — `slice_slug`, `slice_index` (1-based position in the project plan), `linear_ref` (string | null).
- **`slice-completed`** — `slice_slug`, `result` (`"merged"` | `"abandoned"`), `pr_ref` (string | null).
- **`health-check-fired`** — `cadence` (`"opening-rollup"` | `"per-slice-merge"` | `"closing-rollup"` | `"session-bookend"` | `"trigger-fired"`), `drift_signal_count` (int), `max_drift_severity` (`"none"` | `"low"` | `"medium"` | `"high"`), `recommended_next` (string | null).
- **`retro-landed`** — `trigger_class` (`"dispatch-failure"` | `"drift-event"` | `"scope-shift-escapee"` | `"wip-inspection-finding"` | `"operator-flagged-surprise"` | `"mandatory-final"`), `landing_surfaces` (array of `"canonical-skill"` | `"project-context-readme"` | `"adr"`), `is_mandatory_final` (bool).

All six are **additive** to the vocabulary — existing readers that honour `schema_version` are unaffected — so the vocabulary version stays `"1"`.

### Direct-change gap — reuse, don't extend

A direct change never enters `drive-build-workflow`. `drive-start-workflow` Step 5 (direct-change sub-path) assembles the brief and calls `drive-dispatch` directly, so the build-loop spine (`dispatch-start`, `round-start`, `brief-issued`, `round-end`, `dispatch-end`) never fires and the work is invisible. We close this by adding those **same five event types** at the direct-change sub-path in `drive-start-workflow`, modelling a direct change as a single-dispatch, single-round unit:

- `dispatch-start` — `dispatch_name = "direct-change <ticket>"`, `parent_dispatch_id = null`, `subagent_type` / `model` from the planned `drive-dispatch` call.
- `round-start` — `round_number = 1` (one-shot; direct changes don't loop).
- `brief-issued` — `brief_disposition = "initial"`; measures the direct-change brief (the `brief-issued` blind spot called out in slice 1's open questions).
- `round-end` — `verdict` mapped from the dispatch outcome.
- `dispatch-end` — `result` from the dispatch outcome.

Trace-file resolution for a direct change uses the existing `wip/drive-trace/direct-<ISO-ts>.jsonl` path (per `emission.md`); `project_run_id = "direct-<ISO-ts>"`.

### `drive-dispatch` stays uninstrumented (design refinement)

The slice-2 ticket framed `drive-dispatch` as a skill to instrument. The skill mapping refined this: **`drive-dispatch` is a packaging wrapper** — it validates the brief, assembles the delegation prompt, invokes the subagent, and returns. The `dispatch_id` / `round_id` lifecycle state lives with the **orchestrator that calls it** (`drive-build-workflow` in the loop; `drive-start-workflow` for direct changes). Emitting from inside `drive-dispatch` would force it to own state it doesn't have and would fire for both callers without distinguishing build-loop from direct-change context. So the direct-change gap is closed in `drive-start-workflow` (the caller), and `drive-dispatch` gets **no** emit-site. The project plan's slice-2 description is updated to match.

### Per-skill mapping table

The `drive-record-traces` skill's "Instrumented skills" table is extended so the contract names every emitter and the events it fires — including the slice-2 additions.

## Coherence rationale

These changes hang together as one reviewable PR because they share a single contract surface (`drive-record-traces`) and a single shape (additive `> **Emit**` blockquotes at workflow transition points, by-name reference to the library skill, behaviour-preserving). They complete one idea: "the trace captures the whole project run, not just its inner loops." Splitting lifecycle from cadence from direct-change would fragment one vocabulary extension across three reviews of the same files.

## Scope

**In:**

- `skills-contrib/drive-record-traces/events.md` — six new event types (envelope + payload + arktype + JSONL example each); a note documenting the direct-change reuse of the build-loop spine.
- `skills-contrib/drive-record-traces/SKILL.md` — extended "Instrumented skills" table.
- `skills-contrib/drive-create-project/SKILL.md` — `project-started` emit-site.
- `skills-contrib/drive-close-project/SKILL.md` — `project-closed` emit-site.
- `skills-contrib/drive-deliver-workflow/SKILL.md` — `slice-started` + `slice-completed` emit-sites.
- `skills-contrib/drive-check-health/SKILL.md` — `health-check-fired` emit-site.
- `skills-contrib/drive-run-retro/SKILL.md` — `retro-landed` emit-site.
- `skills-contrib/drive-start-workflow/SKILL.md` — five emit-sites on the direct-change sub-path (build-loop spine reuse).
- `projects/drive-instrumentation/plan.md` — slice-2 description refined (direct-change gap closes in `drive-start-workflow`; `drive-dispatch` stays clean).
- `projects/drive-instrumentation/slices/02-…/manual-qa.md` + `qa-run-*.md` + `qa-trace-*.jsonl` — QA covering the new events + direct-change spine.

**Out:**

- `drive-dispatch` instrumentation (design refinement above — the caller owns the emit-sites).
- Any logic that **reads** the trace (assertion library, diagnostic-metrics module, report generator, post-hoc parser) — slice 3.
- QA-side skills (`drive-pr-description`, `drive-pr-walkthrough`, `drive-qa-plan`, `drive-qa-run`, `drive-code-review`) — workflow edges; revisit at close-out if signal demands.
- `discussion-entered` for non-I12 reasons (pre-spec design, mid-spec fork, operator-requested) — slice-1 open question, still deferred; only the I12 `falsified-assumption` event exists.
- A dedicated `verdict-overridden` event (caller overrides a triage verdict) — slice-1 deferral, still out.
- Sub-agent-internal events (heartbeats, intra-round writes) — still orchestrator-side only.
- LLM judge / experiment harness / golden cases — Project 2.

## Approach

### Vocabulary + emission protocol

D1 adds the six event types to `events.md` following the slice-1 section pattern (one `###` per event: trigger, emitting skill, payload table, arktype block, JSONL example), and extends the `Slice1TraceEvent` union (rename or alias as appropriate — keep the union name stable to avoid churn, or introduce `TraceEvent` as the canonical union and keep `Slice1TraceEvent` as an alias). The emission protocol is unchanged; D1 adds a short note to `emission.md` and/or `events.md` documenting the direct-change reuse (the build-loop spine fired from `drive-start-workflow`, with `project_run_id = "direct-<ISO-ts>"`).

### Instrumentation (additive, behaviour-preserving)

Each emit-site is a 1–3-line `> **Emit**` blockquote referencing the `drive-record-traces` skill **by name** (no path), placed at the anchor the mapping identified. No existing prose is rewritten. The anchors (guidance — the implementer confirms against the live skill body on the dispatch):

| Skill | Event(s) | Anchor (guidance) |
|---|---|---|
| `drive-create-project` | `project-started` | after the workspace-scaffold step, before the DoR gate |
| `drive-close-project` | `project-closed` | at the terminal close-out-PR step |
| `drive-deliver-workflow` | `slice-started` | Step 3, immediately before invoking `drive-build-workflow` for the picked slice |
| `drive-deliver-workflow` | `slice-completed` | Step 4, after the slice PR merges |
| `drive-check-health` | `health-check-fired` | Step 4, after the rollup renders |
| `drive-run-retro` | `retro-landed` | Step 7, after the retro entry is appended |
| `drive-start-workflow` | `dispatch-start`, `round-start`, `brief-issued` | Step 5 direct-change items 3–4, before the `drive-dispatch` call |
| `drive-start-workflow` | `round-end`, `dispatch-end` | Step 5 direct-change, after `drive-dispatch` returns |

### Demo + manual QA

D5 extends `manual-qa.md` with checks for the six new events and the direct-change spine, then runs a synthetic walkthrough covering: a `project-started` → slice bookends → opening/per-slice/closing `health-check-fired` → a triggered `retro-landed` + the mandatory-final → `project-closed` arc, plus a standalone direct-change run producing the five-event spine under a `direct-<ts>` run id. The walkthrough produces a committed `qa-trace` and hand-computes the four new signals.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| `project-started` fires, then DoR fails and the project is abandoned | **Handle (no pairing guarantee)** | A `project-started` with no matching `project-closed` is a recognised diagnostic signal (abandoned setup), not an error. Slice-3 assertions can flag it. |
| Project spans multiple sessions; `project-closed` orchestrator lacks `project-started.ts` | **Handle by design** | Project wall-clock is read-side (computed from the trace `ts` pair), not emitted. |
| Slice abandoned (not merged) | **Handle** | `slice-completed.result = "abandoned"`; pairs with `slice-started`. |
| `drive-check-health` invoked outside `drive-deliver-workflow` (operator-triggered) | **Handle** | `cadence = "trigger-fired"`. |
| `drive-run-retro` triggered but never lands (process failure) | **Handle (silent)** | `retro-landed` fires only on landing (the skill's own "not done until the output lands" stance). An un-landed retro is silent; slice-3 assertions infer it from a health-check retro-trigger with no matching `retro-landed`. |
| Mandatory final retro | **Handle** | `retro-landed.trigger_class = "mandatory-final"`, `is_mandatory_final = true`. |
| Direct change that needs a second round (rare) | **Handle** | The spine supports `round_number > 1`; the one-shot framing is the common case, not a constraint. |
| Direct change with no Linear ticket | **Handle** | `dispatch_name` falls back to a short slug; `input_ref`-style fields are null where applicable. |
| `drive-deliver-workflow` re-enters mid-flight (scope shift routes back through `drive-start-workflow`) | **Explicitly out** | No `delivery-loop` event; re-entry is captured by the slice/dispatch events that fire within it. |

## Slice Definition of Done

- [ ] **SDoD1.** All "Done when" gates from the slice plan pass.
- [ ] **SDoD2.** Every pre-named edge case handled per disposition; new edge cases discovered amend the spec via `drive-discussion` (I12).
- [ ] **SDoD3.** Reviewer verdict `SATISFIED` on `reviews/code-review.md` at slice close.
- [ ] **SDoD4.** Manual-QA covers the six new event types + the direct-change spine; `manual-qa.md` re-runnable; ≥ 1 QA run committed; no unresolved 🛑 Blocker findings.
- [ ] **SDoD5.** Slice doesn't touch out-of-scope surfaces (no `drive-dispatch` emit-site; no trace-reading logic; no QA-side-skill instrumentation; no `.agents/skills/` edits — only `skills-contrib/` + project artifacts).
- [ ] **SDoD6.** The six new event types are documented in `events.md` (versioned `schema_version: "1"`, additive) and referenced by name from every new emit-site; the `drive-record-traces` instrumented-skills table lists every slice-2 emitter.
- [ ] **SDoD7.** Every newly instrumented skill verified non-regressing against its uninstrumented baseline (behaviour-preservation read-through, per-skill in its dispatch).
- [ ] **SDoD8.** Trace evidence committed (`qa-trace-*.jsonl`) exercising lifecycle + cadence + direct-change events.

## Open Questions

1. **Union naming.** Slice 1 named the consolidated arktype union `Slice1TraceEvent`. Working position: introduce `TraceEvent` as the canonical union name and keep `Slice1TraceEvent` as a deprecated alias, or rename outright — D1 picks the lower-churn option and records it.
2. **`health-check-fired` drift payload granularity.** Working position: emit `drift_signal_count` + `max_drift_severity` (scalar), not a full per-signal breakdown; slice-3 metrics can re-derive distributions if needed.
3. **Direct-change `round-end.verdict` mapping.** Working position: a successful one-shot direct change maps to `"satisfied"`; a stop-condition halt maps to `"stop-condition"`. D4 confirms against the direct-change sub-path's actual outcomes.
4. **`orchestrator_agent_id`.** Unchanged from slice 1: emit `null` unless a standard read exposes the session UUID.

## References

- Parent project spec: [`projects/drive-instrumentation/spec.md`](../../spec.md).
- Parent project plan: [`projects/drive-instrumentation/plan.md`](../../plan.md).
- Parent project design notes: [`projects/drive-instrumentation/design-notes.md`](../../design-notes.md).
- Slice 1 (the contract this extends): [`projects/drive-instrumentation/slices/01-trace-vocab-and-build-instrumentation/spec.md`](../01-trace-vocab-and-build-instrumentation/spec.md).
- Trace contract: the `drive-record-traces` skill (`events.md`, `emission.md`).
- Linear issue: [TML-2711](https://linear.app/prisma-company/issue/TML-2711).
