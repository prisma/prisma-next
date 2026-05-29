# QA run 01 — slice 02 lifecycle, cadence, and direct-change instrumentation

**Date:** 2026-05-29  
**Runner:** implementer subagent (D5 R1 walkthrough)  
**Mode:** Walkthrough — synthetic scenario simulating orchestrator emit decisions across the full slice-2 emit surface (`drive-create-project`, `drive-close-project`, `drive-deliver-workflow`, `drive-check-health`, `drive-run-retro`, `drive-start-workflow` direct-change sub-path). No live agent dispatch.  
**Trace evidence (lifecycle + cadence):** [`qa-trace-01.jsonl`](./qa-trace-01.jsonl) (12 events; canonical in-project runtime path would be `projects/sample-feature/trace.jsonl`).  
**Trace evidence (direct-change):** [`qa-trace-direct-01.jsonl`](./qa-trace-direct-01.jsonl) (5 events; canonical runtime path would be `wip/drive-trace/direct-2026-05-29T09:30:00Z.jsonl`).

## Scenario

### Lifecycle + cadence arc — project `sample-feature`

Hypothetical `sample-feature` project run on two slices:

| Time | Skill / phase | Trace events |
|---|---|---|
| T08:00 | `drive-create-project` scaffolds project, DoR passes | `project-started` (`origin:"new-project"`, `has_linear_project:true`) |
| T08:05 | `drive-deliver-workflow` Step 1 → `drive-check-health` (opening rollup) | `health-check-fired` (`cadence:"opening-rollup"`, `drift_signal_count:0`) |
| T08:10 | `drive-deliver-workflow` Step 3 → begins slice 1 | `slice-started` (`slice_slug:"01-initial-scaffolding"`, `slice_index:1`, `linear_ref:"TML-3001"`) |
| T10:20 | Slice 1 PR #51 merges | `slice-completed` (`result:"merged"`, `pr_ref:"#51"`) |
| T10:22 | `drive-check-health` (per-slice-merge rollup) | `health-check-fired` (`cadence:"per-slice-merge"`, `drift_signal_count:1`, `max_drift_severity:"low"`) |
| T10:30 | Drift event triggers retro; entry written to `retros.md` | `retro-landed` (`trigger_class:"drift-event"`, `landing_surfaces:["project-context-readme"]`, `is_mandatory_final:false`) |
| T10:40 | `drive-deliver-workflow` Step 3 → begins slice 2 | `slice-started` (`slice_slug:"02-core-logic"`, `slice_index:2`, `linear_ref:"TML-3002"`) |
| T14:00 | Slice 2 PR #57 merges | `slice-completed` (`result:"merged"`, `pr_ref:"#57"`) |
| T14:05 | `drive-check-health` (per-slice-merge rollup) | `health-check-fired` (`cadence:"per-slice-merge"`, `drift_signal_count:0`) |
| T14:20 | `drive-deliver-workflow` Step 6 → `drive-check-health` (closing rollup) | `health-check-fired` (`cadence:"closing-rollup"`, `drift_signal_count:0`) |
| T14:40 | Mandatory final retro; entry written to `retros.md` | `retro-landed` (`trigger_class:"mandatory-final"`, `landing_surfaces:["canonical-skill","project-context-readme"]`, `is_mandatory_final:true`) |
| T15:00 | `drive-close-project` Step 9 (close-out PR opened) | `project-closed` (`dod_status:"all-met"`, `slices_completed:2`, `final_retro_done:true`) |

Load-bearing paths exercised:

- **Full project lifecycle bookend:** `project-started` → slices → `project-closed`; both events share `project_run_id:"sample-feature"`.
- **Slice bookends:** `slice-started` + `slice-completed` pair for each of 2 slices; `slice_index` 1-based sequential.
- **Cadence coverage:** opening-rollup, per-slice-merge (×2), closing-rollup — four `health-check-fired` events covering three of the five documented cadences.
- **Triggered retro:** `drift-event` trigger from the per-slice-merge rollup's drift signal.
- **Mandatory-final retro:** `trigger_class:"mandatory-final"`, `is_mandatory_final:true`; fires before `project-closed`.
- **Retro-landing-only semantics:** retro-landed fires only when the entry was written (Steps 5–7 of `drive-run-retro` completed).

### Direct-change spine — `project_run_id = "direct-2026-05-29T09:30:00Z"`

One-shot direct change against ticket `TML-9999`. Orchestrator routes `drive-start-workflow` Step 5 direct-change sub-path:

| Time | Phase | Trace events |
|---|---|---|
| T09:30:00 | Brief assembled; before `drive-dispatch` call | `dispatch-start`, `round-start`, `brief-issued` |
| T10:15:00–01 | `drive-dispatch` returns `done` | `round-end` (`verdict:"satisfied"`), `dispatch-end` (`result:"completed"`) |

All five events share `dispatch_id:"d9000001-0009-4009-8009-000000000001"`.

## QA check results

| # | Check | Result | Notes |
|---|---|---|---|
| 1 | Trace files exist at resolved paths | **Pass** | Both `qa-trace-01.jsonl` and `qa-trace-direct-01.jsonl` exist in slice folder. |
| 2 | `project-started` present and valid | **Pass** | 1 event; `origin:"new-project"`, `has_linear_project:true`; `project_run_id = project_slug = "sample-feature"`. |
| 3 | `project-closed` present and valid | **Pass** | 1 event; `dod_status:"all-met"`, `slices_completed:2`, `final_retro_done:true`; enum in documented set. |
| 4 | `slice-started` present and valid (≥ 2) | **Pass** | 2 events; `slice_index` values 1 and 2 (1-based, sequential). |
| 5 | `slice-completed` present and valid (≥ 2) | **Pass** | 2 events; `result:"merged"` on both; `pr_ref` non-null. `slice_slug` matches corresponding `slice-started`. |
| 6 | `health-check-fired` present and valid | **Pass** | 4 events; cadence values `opening-rollup`, `per-slice-merge` (×2), `closing-rollup` — all in documented enum; `max_drift_severity:"none"` where `drift_signal_count:0`. |
| 7 | `retro-landed` present and valid (≥ 2) | **Pass** | 2 events; triggered entry `is_mandatory_final:false`; mandatory-final entry `is_mandatory_final:true` with `trigger_class:"mandatory-final"`; `landing_surfaces` arrays non-empty. |
| 8 | Project/slice bookend pairing | **Pass** | 1 `project-started`, 1 `project-closed` (same `project_run_id`). `slice-started` slugs: `["01-initial-scaffolding","02-core-logic"]`; `slice-completed` slugs: same. No unpaired slugs. |
| 9 | Cadence-enum coverage | **Pass** | Cadences found: `["opening-rollup","per-slice-merge","per-slice-merge","closing-rollup"]`. All four values are in the documented five-value enum; no illegal strings. |
| 10 | Retro-landing-only semantics | **Pass** | Both `retro-landed` events correspond to Steps 5–7 of `drive-run-retro` in the scenario narrative. No retro trigger in the scenario was left un-landed. |
| 11 | Direct-change spine completeness | **Pass** | All 5 event types present in order; `project_run_id` starts with `direct-`; `dispatch_name:"direct-change tml-9999"`; `round_number:1`; `parent_dispatch_id:null`; `brief_disposition:"initial"`; `verdict:"satisfied"`, `result:"completed"`. |
| 12 | `drive-dispatch` stays-clean grep gate | **Pass** | `rg "> \*\*Emit" skills-contrib/drive-dispatch/SKILL.md` returns no matches (exit 1). See verification section below. |
| 13 | Payload-shape conformance (all events) | **Pass** | All 17 events across both traces: flat objects with envelope + event-specific fields; `schema_version:"1"`; no extra top-level keys; all enum values match `events.md` documented literals. |

## Verification commands run

```bash
# Both traces parse as JSON
python3 -c "import json;[json.loads(l) for l in open('projects/drive-instrumentation/slices/02-lifecycle-cadence-and-direct-change/qa-trace-01.jsonl')]"
# → exit 0

python3 -c "import json;[json.loads(l) for l in open('projects/drive-instrumentation/slices/02-lifecycle-cadence-and-direct-change/qa-trace-direct-01.jsonl')]"
# → exit 0

# drive-dispatch grep gate
rg "> \*\*Emit" skills-contrib/drive-dispatch/SKILL.md
# → no output; exit 1 (PASS)
```

## Hand-computation: four slice-2 signals

### Signal 1 — Project wall-clock

**Formula:** `project-closed.ts − project-started.ts`

| Event | Line | `ts` |
|---|---|---|
| `project-started` | 1 | `2026-05-29T08:00:00.000Z` |
| `project-closed` | 12 | `2026-05-29T15:00:00.000Z` |

**Derivation:**

- T_closed = 15:00:00 UTC
- T_started = 08:00:00 UTC
- Δ = 7 hours = 7 × 3 600 s = 25 200 s = **25 200 000 ms**

**Project wall-clock = 25 200 000 ms (7 h)**

---

### Signal 2 — Per-slice wall-clock

**Formula:** `slice-completed.ts − slice-started.ts` per slice.

#### Slice 1 — `01-initial-scaffolding`

| Event | Line | `ts` |
|---|---|---|
| `slice-started` | 3 | `2026-05-29T08:10:00.000Z` |
| `slice-completed` | 4 | `2026-05-29T10:20:00.000Z` |

- Δ = 10:20 − 08:10 = 2 h 10 min = 130 min = 7 800 s = **7 800 000 ms**

#### Slice 2 — `02-core-logic`

| Event | Line | `ts` |
|---|---|---|
| `slice-started` | 7 | `2026-05-29T10:40:00.000Z` |
| `slice-completed` | 8 | `2026-05-29T14:00:00.000Z` |

- Δ = 14:00 − 10:40 = 3 h 20 min = 200 min = 12 000 s = **12 000 000 ms**

| Slice | `slice-started.ts` | `slice-completed.ts` | Wall-clock |
|---|---|---|---|
| `01-initial-scaffolding` | T08:10 | T10:20 | **7 800 000 ms (2 h 10 min)** |
| `02-core-logic` | T10:40 | T14:00 | **12 000 000 ms (3 h 20 min)** |

---

### Signal 3 — Health-check cadence distribution

**Formula:** count `health-check-fired` events grouped by `cadence` field.

| Line | `cadence` |
|---|---|
| 2 | `opening-rollup` |
| 5 | `per-slice-merge` |
| 9 | `per-slice-merge` |
| 10 | `closing-rollup` |

| `cadence` | count |
|---|---|
| `opening-rollup` | **1** |
| `per-slice-merge` | **2** |
| `closing-rollup` | **1** |
| `session-bookend` | 0 |
| `trigger-fired` | 0 |
| **Total** | **4** |

---

### Signal 4 — Retro frequency + trigger distribution + direct-change visibility

#### Retro frequency and trigger distribution

**Formula:** count `retro-landed` events grouped by `trigger_class`.

| Line | `trigger_class` | `is_mandatory_final` |
|---|---|---|
| 6 | `drift-event` | `false` |
| 11 | `mandatory-final` | `true` |

| `trigger_class` | count |
|---|---|
| `drift-event` | **1** |
| `mandatory-final` | **1** |
| **Total** | **2** |

#### Direct-change visibility

From `qa-trace-direct-01.jsonl` — five events grouped by `dispatch_id = "d9000001-0009-4009-8009-000000000001"`:

| Line | `event_type` | `ts` |
|---|---|---|
| 1 | `dispatch-start` | T09:30:00 |
| 2 | `round-start` | T09:30:01 |
| 3 | `brief-issued` | T09:30:02 |
| 4 | `round-end` | T10:15:00 |
| 5 | `dispatch-end` | T10:15:01 |

**Spine complete:** `dispatch-start → round-start → brief-issued → round-end → dispatch-end` present in order under one `dispatch_id`. Direct-change work is now visible in the trace; dispatch wall-clock = **2 701 000 ms (≈ 45 min)**.

---

## Behaviour-preservation attestation

Emit blockquotes are additive in all six newly instrumented skill bodies; workflow steps checked for semantic preservation:

| Skill | Emit-site | Adjacent prose checked | Attestation |
|---|---|---|---|
| `drive-create-project` | After stubs/scaffold section, before Project DoR check | DoR checklist (purpose statement, scope boundary, operator availability, external dependencies, Linear Project) | **Unchanged.** Stub-file templates and DoR items verbatim before and after the emit blockquote. The emit is inserted between the scaffold section and `## Project DoR check`; neither section is rewritten. |
| `drive-close-project` | Step 9 (open close-out PR), after push instruction | Commit cadence (`commit-as-you-go`); PR description requirements (DoD block, migration summary, Linear reference) | **Unchanged.** The emit blockquote appears at the end of Step 9 after `"Push and open the PR."`; all Step 9 prose (delegation to `drive-pr-description`, commit cadence, Linear reference requirement) precedes the emit intact. |
| `drive-deliver-workflow` | Step 3 (`slice-started`) immediately before `drive-build-workflow` invocation | Step 3 prose: "Invoke `drive-build-workflow` on the picked slice. It pilots the dispatch loop and returns when one of: Slice DoD met / Stop-condition fired." | **Unchanged.** The emit blockquote is the opening of Step 3; the invocation instruction and the two return-condition descriptions that follow are unmodified. |
| `drive-deliver-workflow` | Step 4 (`slice-completed`) before `drive-check-health` session-bookend | Step 4 prose: "Run `drive-check-health` in **session-bookend mode**…"; retro-trigger invocation rule | **Unchanged.** The emit blockquote is the opening of Step 4; the health-check instruction and the retro-trigger policy that follow are unmodified. |
| `drive-check-health` | Step 4 (`health-check-fired`) after rollup render | Step 4 render instruction: "Interactive: display in chat. Unattended: write to `projects/<project>/rollups/<timestamp>.md`…" | **Unchanged.** The render instruction precedes the emit blockquote; Step 5 (downstream recommendations, policy-gated) follows and is unmodified. |
| `drive-run-retro` | Step 7 (`retro-landed`) after retro entry appended | Step 7 instruction: "Append to `projects/<project>/retros.md` (create if missing) using the retro-entry template." | **Unchanged.** The append instruction precedes the emit blockquote; Step 8 (mandatory-final specifics, conditional) follows and is unmodified. The emit is explicitly gated to landing ("This event fires only when the retro entry has been written"). |
| `drive-start-workflow` | Step 5 direct-change sub-path: `dispatch-start`, `round-start`, `brief-issued` before `drive-dispatch`; `round-end`, `dispatch-end` after return | Item 3: "Branch from `main`. Assemble a dispatch brief…"; item 4: "Call `drive-dispatch` with: the brief; `null` implementer ID…"; items 5–6 (gh pr create / blocked handling) | **Unchanged.** The three pre-call emits are inserted after the brief-assembly instruction; item 4 (the `drive-dispatch` call and its parameters) is verbatim. The two post-return emits precede item 5 and item 6; the `gh pr create` and `blocked` handling instructions are unmodified. No other verdict sub-path (slice, project, promote, demote, spike, defer) is touched. |

**Representative fragment (`drive-start-workflow` § Step 5 direct-change, pre-emit workflow step):**

> 3. Branch from `main`. Assemble a dispatch brief (use the *direct-change* shape of `drive-dispatch/templates/dispatch-brief.template.md` — references point at the PR description draft and Linear ticket, not at a slice spec).
>
> *(emit `dispatch-start`, `round-start`, `brief-issued`)*
>
> 4. Call `drive-dispatch` with: the brief; **`null` implementer ID** (one-shot — no continuity to preserve); `foreground` multitasking policy (nothing to prep in parallel for a single dispatch); no carry-over.

No emit-site rewrites the dispatch call's parameters, the `gh pr create` step, the blocked-return handler, or any non-direct-change verdict sub-path.

## Design choices (walkthrough ambiguities)

| Choice | Reading |
|---|---|
| `health-check-fired.cadence` values exercised | Three of five documented cadences (`opening-rollup`, `per-slice-merge`, `closing-rollup`). `session-bookend` and `trigger-fired` are documented but not in scope for this two-slice scenario; they are verified structurally via the enum check (Check 9). |
| `drive-check-health` invoked in Step 4 labelled `session-bookend` in spec vs `per-slice-merge` | The deliver-workflow Step 4 comment says "session-bookend mode"; the events.md cadence enum has `per-slice-merge` for "after each slice merges, before picking the next." Per-slice-merge is the correct value — the skill body Step 4 confirms the cadence is "read from the invoking context," which here is the per-slice-merge point. Trace uses `per-slice-merge`. |
| `orchestrator_agent_id` | `null` per slice-1 standing decision. |
| `findings_filed` on direct-change `round-end` | `0` — direct changes have no `code-review.md` per `drive-start-workflow`; best-effort field as documented. |
| Direct-change `project_run_id` format | `direct-2026-05-29T09:30:00Z` — colons are percent-encoded or replaced in filenames but used as-is in the `project_run_id` string field per `emission.md` path resolution. |

## Status

**no unresolved 🛑 Blocker findings**
