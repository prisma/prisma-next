# Manual QA: slice 01 trace vocabulary + build instrumentation

Re-runnable checklist for verifying that a `trace.jsonl` produced by (or simulating) the instrumented `drive-build-workflow` loop matches the slice-1 vocabulary and supports hand-computation of the two diagnostic metrics.

**References:** [`docs/drive/trace-events.md`](../../../../docs/drive/trace-events.md) (payload shapes), [`docs/drive/trace-emission.md`](../../../../docs/drive/trace-emission.md) (path resolution), [`skills-contrib/drive-build-workflow/SKILL.md`](../../../../skills-contrib/drive-build-workflow/SKILL.md) (emit-site anchors).

**Execution modes:**

- **Walkthrough (slice-1 QA):** read the instrumented skill body, simulate orchestrator emit decisions at each anchor for a synthetic scenario, write the resulting JSONL. No live agent dispatch required.
- **Live run (future):** run `drive-build-workflow` on a small in-repo task; the trace file appears at the resolved path per project context.

Set `TRACE_FILE` to the trace under test. For in-project work the canonical runtime path is `projects/<project-slug>/trace.jsonl` (e.g. `projects/drive-instrumentation/trace.jsonl`). For this slice's committed evidence, use `qa-trace-01.jsonl` in this folder.

---

## Pre-flight (before running checks)

1. Confirm the instrumented skill body lists five emit blockquotes in `skills-contrib/drive-build-workflow/SKILL.md` § The per-dispatch loop (§ 1 top, § 1 end, § 2 before `drive-dispatch`, § 6 after triage).
2. Choose or record the scenario: at minimum one dispatch with **multiple rounds** (`rounds_per_dispatch > 1`) and at least one `brief-issued` with `brief_disposition: "amended"`.
3. If simulating, walk anchors in temporal order per dispatch: `dispatch-start → (round-start → brief-issued → … → round-end)+ → dispatch-end`.

---

## QA checks

### Check 1 — Trace file exists at resolved path

**Pass when:** the trace file exists at the path appropriate to project context:

| Context | Expected path |
|---|---|
| In-project | `projects/<project-slug>/trace.jsonl` |
| Orphan slice | `wip/drive-trace/orphan-<slice-slug>.jsonl` |
| Direct change | `wip/drive-trace/direct-<ISO-timestamp>.jsonl` |

For slice-folder evidence runs, `qa-trace-01.jsonl` in this directory satisfies the structural checks below.

**Command:**

```bash
test -f "$TRACE_FILE" && echo "exists"
```

---

### Check 2 — All five slice-1 event types present

**Pass when:** the trace contains at least one line for each of: `dispatch-start`, `dispatch-end`, `round-start`, `round-end`, `brief-issued`.

**Command:**

```bash
for t in dispatch-start dispatch-end round-start round-end brief-issued; do
  rg -q "\"event_type\":\"$t\"" "$TRACE_FILE" || echo "MISSING: $t"
done
```

---

### Check 3 — Every line is valid JSON

**Pass when:** `jq` parses every line without error.

**Command:**

```bash
jq -c . "$TRACE_FILE" > /dev/null && echo "all lines parse"
```

---

### Check 4 — Payload shape matches vocabulary

**Pass when:** every event is a flat object with exactly the envelope fields plus the event-type-specific fields documented in `docs/drive/trace-events.md`, with no extra top-level keys and no missing required fields.

**Envelope (all events):** `event_id`, `event_type`, `schema_version` (`"1"`), `ts`, `project_run_id`, `orchestrator_agent_id`.

**Per event type (additional fields only):**

| `event_type` | Required payload fields |
|---|---|
| `dispatch-start` | `dispatch_id`, `dispatch_name`, `subagent_type`, `model`, `parent_dispatch_id` |
| `dispatch-end` | `dispatch_id`, `result`, `wall_clock_ms` |
| `round-start` | `dispatch_id`, `round_id`, `round_number` |
| `round-end` | `dispatch_id`, `round_id`, `verdict`, `findings_filed`, `wall_clock_ms` |
| `brief-issued` | `dispatch_id`, `round_id`, `brief_byte_length`, `brief_content_hash`, `brief_disposition` |

**Manual spot-check or script:** for each line, verify key set equals envelope + payload for that `event_type`. Enum values must match documented literals.

---

### Check 5 — Per-dispatch temporal ordering

**Pass when:** for each `dispatch_id`, a linear scan of the file yields:

```
dispatch-start
  (round-start → brief-issued → round-end)+   [one or more rounds]
dispatch-end
```

Intermediate events between `brief-issued` and `round-end` (WIP inspection, DoD, reviewer) are not traced in slice 1 — gaps are expected. Within each round, `round-start` must precede `brief-issued`, which must precede `round-end`. `dispatch-start` must precede the first `round-start` for that `dispatch_id`. `dispatch-end` must follow the last `round-end` for that `dispatch_id`.

**Procedure:** group lines by `dispatch_id`; verify ordering constraints above.

---

### Check 6 — `rounds_per_dispatch` computable

**Definition:** for each `dispatch_id`, count `round-end` events with that `dispatch_id`.

**Pass when:** the count is computed by hand (or script) for at least one dispatch and recorded in the run report.

**Example:**

```bash
jq -r 'select(.event_type=="round-end") | .dispatch_id' "$TRACE_FILE" | sort | uniq -c
```

---

### Check 7 — Brief-churn narrow metric computable

**Definition:** for each `dispatch_id`, let `S` = sum of `brief_byte_length` across all `brief-issued` events for that dispatch, and `M` = max `brief_byte_length` in that dispatch. Brief-churn = `S / M`.

**Pass when:** the ratio is computed by hand for at least one dispatch and recorded in the run report.

**Example (dispatch with two briefs):**

```text
S = 2048 + 3072 = 5120
M = 3072
brief-churn = 5120 / 3072 ≈ 1.667
```

---

### Check 8 — `spec-authored` present and schema-valid

**Pass when:** the trace contains at least one `spec-authored` event whose payload matches `docs/drive/trace-events.md` § `spec-authored`: `spec_path`, `spec_kind` (`"project"` \| `"slice"`), `byte_length`, `edge_cases_count` (`null` for project specs), `open_questions_count`, `dod_items_count`.

**Command:**

```bash
rg '"event_type":"spec-authored"' "$TRACE_FILE"
jq 'select(.event_type=="spec-authored")' "$TRACE_FILE"
```

**Expected on pass:** first write of each spec path emits `spec-authored` (existence-check saw no prior file). Sample: [`qa-trace-02.jsonl`](./qa-trace-02.jsonl) lines with `spec_kind: "project"` then `spec_kind: "slice"`.

---

### Check 9 — `spec-amended` present and schema-valid

**Pass when:** at least one `spec-amended` with `bytes_delta`, `reason` (documented enum), `sections_changed` (string array), and the same per-kind counters as `spec-authored`.

**Command:**

```bash
rg '"event_type":"spec-amended"' "$TRACE_FILE"
jq 'select(.event_type=="spec-amended") | {spec_path, reason, bytes_delta}' "$TRACE_FILE"
```

**Expected on pass:** re-write of an on-disk spec emits `spec-amended`; never the first write of a path. Sample: operator correction on project spec, then replan-from-discussion on slice spec in `qa-trace-02.jsonl`.

---

### Check 10 — `plan-authored` present and schema-valid

**Pass when:** at least one `plan-authored` with `plan_path`, `plan_kind`, `byte_length`, nullable `dispatch_count` / `slice_count` / `dispatch_size_distribution` per kind, and `open_items_count`.

**Command:**

```bash
rg '"event_type":"plan-authored"' "$TRACE_FILE"
jq 'select(.event_type=="plan-authored")' "$TRACE_FILE"
```

**Expected on pass:** project plan has `slice_count` populated and slice-plan fields null; slice plan inverts that pattern. See `qa-trace-02.jsonl` project + slice `plan-authored` pair.

---

### Check 11 — `plan-amended` present and schema-valid

**Pass when:** at least one `plan-amended` with `bytes_delta`, `reason`, and slice-plan-only counters `dispatches_added`, `dispatches_removed`, `dispatches_resized` (`null` on project plans).

**Command:**

```bash
rg '"event_type":"plan-amended"' "$TRACE_FILE"
jq 'select(.event_type=="plan-amended")' "$TRACE_FILE"
```

**Expected on pass:** amendment follows an earlier `plan-authored` for the same `plan_path`. Sample: `reason: "dispatch-added"` after I12 replan in `qa-trace-02.jsonl`.

---

### Check 12 — `triage-verdict` present and schema-valid

**Pass when:** at least one `triage-verdict` with `verdict`, `input_shape`, and `input_ref` (`string` or `null`) from documented enums.

**Command:**

```bash
rg '"event_type":"triage-verdict"' "$TRACE_FILE"
jq 'select(.event_type=="triage-verdict") | {verdict, input_shape, input_ref}' "$TRACE_FILE"
```

**Expected on pass:** one event per triage invocation. Sample: initial `"new-project"` + mid-flight `"demote"` on the same ticket in `qa-trace-02.jsonl`.

---

### Check 13 — `falsified-assumption` present and schema-valid

**Pass when:** at least one `falsified-assumption` with `artifact_path`, `triggered_by` (documented enum), and `assumption_summary` (`string` or `null`).

**Command:**

```bash
rg '"event_type":"falsified-assumption"' "$TRACE_FILE"
jq 'select(.event_type=="falsified-assumption")' "$TRACE_FILE"
```

**Expected on pass:** event precedes or accompanies the replan `spec-amended` / `plan-amended` pair on the falsified artefact path. Sample: implementer-pushback on slice spec in `qa-trace-02.jsonl`.

---

### Check 14 — All eleven slice-1 event types present

**Pass when:** the trace contains at least one line for each of the five build-loop types (check 2) **and** the six planning-chain types (checks 8–13).

**Command:**

```bash
for t in dispatch-start dispatch-end round-start round-end brief-issued \
         spec-authored spec-amended plan-authored plan-amended triage-verdict falsified-assumption; do
  rg -q "\"event_type\":\"$t\"" "$TRACE_FILE" || echo "MISSING: $t"
done
```

**Expected on pass:** no `MISSING` lines; `qa-trace-02.jsonl` carries 23 events covering all eleven types.

---

### Check 15 — Existence-check: `*-authored` vs `*-amended` selection

**Pass when:** for each `spec_path` / `plan_path`, the **first** trace event for that path is `*-authored`; every subsequent write is `*-amended`. No path's first event is `*-amended` unless a prior `*-authored` for that path appears earlier in the file (cross-session replays are out of scope — within one trace, ordering must hold).

**Procedure:** group `spec-authored` / `spec-amended` by `spec_path`; group `plan-authored` / `plan-amended` by `plan_path`; verify first event per path is authored; verify amended events follow authored for that path.

**Expected on pass:** `qa-trace-02.jsonl` — `projects/drive-instrumentation/spec.md`: authored → amended; slice spec and slice plan: authored → amended after I12 replan.

---

### Check 16 — I12-trigger gating (`falsified-assumption` T3-only)

**Pass when:** every `falsified-assumption` in the trace corresponds to a mid-flight I12 halt (trigger 3 in `drive-discussion`). The trace contains **no** event implying obstacle-triggered discussion (trigger 4) produced a `falsified-assumption` — slice 1 is silent on T4.

**Procedure:** read `skills-contrib/drive-discussion/SKILL.md` § Entering the mode emit blockquote; confirm walkthrough/scenario routed discussion via trigger 3 only. Count `falsified-assumption` events; each must pair with `triggered_by` from halt context, not obstacle framing.

**Expected on pass:** exactly one `falsified-assumption` in `qa-trace-02.jsonl`; no second event with obstacle-only narrative; `drive-discussion` blockquote explicitly lists T4 as non-emitting.

---

### Check 17 — Per-ticket re-triage signal

**Pass when:** for at least one `input_ref` value, `triage-verdict` count is **> 1** (re-triage / promote / demote ceremony visible in trace).

**Command:**

```bash
jq -r 'select(.event_type=="triage-verdict") | .input_ref' "$TRACE_FILE" | sort | uniq -c
```

**Expected on pass:** `2 TML-2704` (initial `new-project`, mid-flight `demote`) in `qa-trace-02.jsonl`.

---

### Check 18 — Seven-to-eight verdict mapping

**Pass when:** each `triage-verdict.verdict` in the trace is a value produced by the mapping in `skills-contrib/drive-triage-work/SKILL.md` § Step 4: `Direct change` → `"direct-change"`; `Slice` → `"orphan-slice"` or `"in-project-slice"`; fresh `Project` → `"new-project"` (not `"promote"`); mid-flight promote → `"promote"`; `Demote` → `"demote"`; `Spike` → `"spike-first"`; `Defer` → `"defer"`. No undocumented verdict strings.

**Procedure:** for each `triage-verdict` line, confirm `verdict` is in the eight-value enum and matches the scenario's triage branch (e.g. fresh Linear ticket → `"new-project"`, not `"promote"`).

**Expected on pass:** `qa-trace-02.jsonl` uses `"new-project"` + `"demote"` only; both are canonical mapped values.

---

### Check 19 — `drive-specify-slice` orphan-mode silence

**Pass when:** orphan-mode slice specs (PR-body injection, no on-disk `spec.md`) produce **no** `spec-authored` / `spec-amended` events; in-project mode emits after disk write.

**Procedure:** read `skills-contrib/drive-specify-slice/SKILL.md` § Step 5 emit blockquote ("in-project mode only — orphan mode skips this emit"). Walkthrough uses in-project mode → events present; attest orphan path would emit zero spec events.

**Expected on pass:** `qa-trace-02.jsonl` slice spec events use `projects/.../slices/.../spec.md` (in-project); orphan silence verified by skill read-through, not by a missing event in this trace.

---

### Check 20 — `drive-plan-slice` dual-mode `plan_path` resolution

**Pass when:** slice-plan emit uses a repo-relative `plan_path` matching the write mode documented in `skills-contrib/drive-plan-slice/SKILL.md`: inline plan under `## Dispatch plan` in the slice spec file **or** separate `projects/<project>/slices/<slice>/plan.md`. Existence-check runs on that resolved path before choosing `plan-authored` vs `plan-amended`.

**Procedure:** confirm `plan-authored` / `plan-amended` events in the trace share one consistent `plan_path` for the slice; first event is authored; amendment targets the same path.

**Expected on pass:** `qa-trace-02.jsonl` uses separate-file mode — `plan_path: "projects/drive-instrumentation/slices/01-trace-vocab-and-build-instrumentation/plan.md"` for both slice plan events.

---

## Run report template

After executing checks, write `qa-run-01.md` (build-loop-only evidence) or `qa-run-02.md` (full eleven-type walkthrough) with:

- Date and runner
- Scenario description
- Pass/fail per check (1–7 for run 01; 1–20 for run 02)
- Hand-computation tables for checks 6–7 and planning-chain quality signals (run 02)
- Behaviour-preservation read-through across all seven instrumented skill bodies (run 02)
- Concluding status: `no unresolved 🛑 Blocker findings` or list blockers

Commit `qa-trace-01.jsonl` (run 01) or `qa-trace-02.jsonl` (run 02) alongside the matching run report as structural evidence.
