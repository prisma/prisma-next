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

## Run report template

After executing checks, write `qa-run-01.md` (or increment the run number) with:

- Date and runner
- Scenario description
- Pass/fail per check (1–7)
- Hand-computation tables for checks 6 and 7
- Behaviour-preservation note (emit-sites additive in skill body)
- Concluding status: `no unresolved 🛑 Blocker findings` or list blockers

Commit `qa-trace-01.jsonl` alongside the run report as structural evidence.
