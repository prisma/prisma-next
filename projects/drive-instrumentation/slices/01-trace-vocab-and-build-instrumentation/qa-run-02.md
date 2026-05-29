# QA run 02 — slice 01 full trace vocabulary (eleven event types)

**Date:** 2026-05-28  
**Runner:** implementer subagent (D6 R1 walkthrough)  
**Mode:** Walkthrough — synthetic scenario simulating orchestrator emit decisions across the full planning chain (D4–D5b) plus the build loop (D2–D3). No live agent dispatch.  
**Trace evidence:** [`qa-trace-02.jsonl`](./qa-trace-02.jsonl) (23 events; canonical in-project runtime path would be `projects/drive-instrumentation/trace.jsonl`).

## Scenario

Hypothetical `drive-instrumentation` project run on Linear ticket `TML-2704`:

| Time | Skill / phase | Trace events |
|---|---|---|
| T0 | Operator hands fresh Linear ticket → `drive-triage-work` | `triage-verdict` (`new-project`, `linear-ticket`, `TML-2704`) |
| T0+5m | `drive-specify-project` writes project spec | `spec-authored` |
| T0+8m | Operator correction → spec amended | `spec-amended` (`operator-correction`) |
| T0+15m | `drive-plan-project` writes project plan | `plan-authored` |
| T0+20m | Mid-flight re-triage (scope discovery: slice not project) | `triage-verdict` (`demote`, `mid-flight-scope-signal`, same `input_ref`) |
| T0+25m | `drive-specify-slice` writes slice spec (in-project) | `spec-authored` (slice) |
| T0+30m | `drive-plan-slice` writes slice plan (separate file mode) | `plan-authored` (slice) |
| T0+35m | `drive-build-workflow` dispatch D1 (single round) | build-loop spine → `dispatch-end` |
| T0+1hr | Dispatch D2 opens; R1 implementer pushback → `drive-discussion` (I12 trigger 3) | `falsified-assumption` |
| T0+1hr+25m | Discussion resolves; slice spec + plan amended | `spec-amended` (`replan-from-discussion`), `plan-amended` (`dispatch-added`) |
| T0+1hr+28m | D2 R1 closes on halt; R2 resumes with amended brief | `round-end` (`stop-condition`), then R2 satisfied → `dispatch-end` |

Load-bearing paths exercised:

- **I12 halt → replan:** falsified assumption on slice spec → discussion → spec/plan amendment → dispatch resumes.
- **Re-triage:** two `triage-verdict` events share `input_ref: "TML-2704"`.
- **Existence-check:** first write per path is `*-authored`; amendments are `*-amended`.
- **T3-only gating:** single `falsified-assumption`; no T4 obstacle emit (slice 2 deferred).

## QA check results

| # | Check | Result | Notes |
|---|---|---|---|
| 1 | Trace file at resolved path | **Pass** | `qa-trace-02.jsonl` exists in slice folder. |
| 2 | All five build-loop event types present | **Pass** | One or more of each build-loop type. |
| 3 | Every line valid JSON | **Pass** | `jq -c . qa-trace-02.jsonl > /dev/null` exit 0. |
| 4 | Build-loop payload shape | **Pass** | All build-loop events match envelope + per-type fields; no extra keys. |
| 5 | Per-dispatch temporal ordering | **Pass** | D1: single-round spine. D2: R1 halt → replan events → `round-end` → R2 spine → `dispatch-end`. |
| 6 | `rounds_per_dispatch` computable | **Pass** | See hand-computation below. |
| 7 | Brief-churn narrow metric computable | **Pass** | See hand-computation below. |
| 8 | `spec-authored` present and valid | **Pass** | 2 events (project + slice); schemas match vocab. |
| 9 | `spec-amended` present and valid | **Pass** | 2 events; reasons `operator-correction` + `replan-from-discussion`. |
| 10 | `plan-authored` present and valid | **Pass** | 2 events (project + slice); nullable fields correct per kind. |
| 11 | `plan-amended` present and valid | **Pass** | 1 event; slice counters populated. |
| 12 | `triage-verdict` present and valid | **Pass** | 2 events; enums from documented sets. |
| 13 | `falsified-assumption` present and valid | **Pass** | 1 event; `triggered_by: implementer-pushback`. |
| 14 | All eleven event types present | **Pass** | No missing types across full checklist. |
| 15 | Existence-check authored vs amended | **Pass** | Each path: authored first, amended second. |
| 16 | I12 T3-only gating | **Pass** | One falsified-assumption; skill blockquote confirms T4 silent. |
| 17 | Per-ticket re-triage signal | **Pass** | `TML-2704` appears twice. |
| 18 | Seven-to-eight verdict mapping | **Pass** | `new-project` + `demote` are canonical mapped values. |
| 19 | specify-slice orphan silence | **Pass** | In-project trace emits; orphan path attested silent via skill read-through. |
| 20 | plan-slice dual-mode `plan_path` | **Pass** | Separate-file mode; consistent `plan_path` on authored + amended. |

## Hand-computation: `rounds_per_dispatch`

Count `round-end` events grouped by `dispatch_id`:

| `dispatch_id` | `round-end` count | `rounds_per_dispatch` |
|---|---|---|
| `d3333333-3333-4333-8333-333333333333` (D1) | 1 | **1** |
| `d4444444-4444-4444-8444-444444444444` (D2) | 2 | **2** |

## Hand-computation: brief-churn narrow metric

**Dispatch D1** (`d3333333-…`): one brief → churn = **1.0**.

**Dispatch D2** (`d4444444-…`):

| Round | `brief_byte_length` | `brief_disposition` |
|---|---|---|
| 1 | 2560 | initial |
| 2 | 3584 | amended |

- `S = 2560 + 3584 = 6144`
- `M = 3584`
- **Brief-churn = 6144 / 3584 ≈ 1.714**

## Hand-computation: planning-chain quality signals

### `spec_amendment_rate[project]`

Count `spec-amended` with `spec_path` under `projects/drive-instrumentation/`:

| `spec_path` | `reason` |
|---|---|
| `projects/drive-instrumentation/spec.md` | `operator-correction` |
| `projects/drive-instrumentation/slices/01-trace-vocab-and-build-instrumentation/spec.md` | `replan-from-discussion` |

**Total:** 2  
**Reason distribution:** `operator-correction`: 1, `replan-from-discussion`: 1

### `plan_amendment_rate[slice]`

Count `plan-amended` with `plan_path` under `projects/drive-instrumentation/slices/01-trace-vocab-and-build-instrumentation/`:

| `plan_path` | `reason` |
|---|---|
| `.../plan.md` | `dispatch-added` |

**Total:** 1  
**Reason distribution:** `dispatch-added`: 1

### `i12_halt_rate[project]`

Count `falsified-assumption` with `artifact_path` under `projects/drive-instrumentation/`:

| `artifact_path` | `triggered_by` |
|---|---|
| `projects/drive-instrumentation/slices/01-trace-vocab-and-build-instrumentation/spec.md` | `implementer-pushback` |

**Total:** 1  
**`triggered_by` distribution:** `implementer-pushback`: 1

### `triage_stability[ticket]`

Count `triage-verdict` with `input_ref = ticket`:

| `input_ref` | count | interpretation |
|---|---|---|
| `TML-2704` | **2** | re-triages (> 1) |

## Behaviour-preservation read-through

Emit blockquotes are additive in all seven instrumented skills; workflow steps checked for semantic preservation:

| Skill | Section checked | Attestation |
|---|---|---|
| `drive-build-workflow` | § The per-dispatch loop (DoR checklist before § 1 emit) | Unchanged — e.g. dispatch-INVEST gate verbatim before `dispatch-start` emit. |
| `drive-specify-project` | Steps 3–5 (ground → fill template → hand off) | Unchanged — Step 4 template order and hand-off to `drive-plan-project` intact; emit appended after Step 4 write. |
| `drive-specify-slice` | Steps 4–6 (fill → write/inject → hand off) | Unchanged — orphan vs in-project write modes preserved; emit gated to in-project only. |
| `drive-plan-project` | Step 6 (compose plan → hand off) | Unchanged — slice/direct-change sequencing prose intact; emit after plan write. |
| `drive-plan-slice` | Step 6 (dispatch decomposition) | Unchanged — inline vs separate plan modes documented; emit resolves `plan_path` from write mode. |
| `drive-triage-work` | Steps 1–4 (decision tree → emit verdict) | Unchanged — seven verdict verbs + rationale return unchanged; `triage-verdict` emit appended at Step 4. |
| `drive-discussion` | § Entering the mode steps 1–4 | Unchanged — persona load, pre-flight, mode shift, opening question sequence intact; `falsified-assumption` emit T3-only after step 4 (F6 fixup). |

**Representative fragment (`drive-triage-work` § Step 4, pre-emit workflow):**

> Return three things to the caller:
>
> - **Verdict** — one of the seven verbs above.
> - **Rationale** — one paragraph: which branches fired, what evidence supports the choice.
> - **Operator authorisation required** — `true` for PROMOTE, DEMOTE, and any PROJECT verdict where the scope hints at more work than the entry-point implied; `false` otherwise.

No emit-site rewrites triage decision logic, discussion synthesis steps, spec/plan template order, or build-loop WIP/DoD/reviewer semantics.

## Design choices (walkthrough ambiguities)

| Choice | Reading |
|---|---|
| Replan events between `brief-issued` and `round-end` | Spec/plan amendments during D2 R1 are traced; WIP/DoD/review gaps remain untraced (slice-1 spine). |
| D2 R1 `round-end.verdict` | `stop-condition` after I12 halt routed to discussion; dispatch resumes as R2 (not a new dispatch). |
| `orchestrator_agent_id` | `null` per slice-1 standing decision. |

## Status

**no unresolved 🛑 Blocker findings**
