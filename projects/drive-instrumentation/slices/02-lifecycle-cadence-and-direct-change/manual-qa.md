# Manual QA: slice 02 lifecycle, cadence, and direct-change instrumentation

Re-runnable checklist for verifying that `trace.jsonl` files produced by (or simulating) the instrumented slice-2 skills carry the six new lifecycle/cadence event types and the direct-change spine, and that the four new hand-computable signals can be derived from them.

**References:** [`skills-contrib/drive-record-traces/events.md`](../../../../skills-contrib/drive-record-traces/events.md) (payload shapes — §§ `project-started` through `retro-landed`), [`skills-contrib/drive-record-traces/emission.md`](../../../../skills-contrib/drive-record-traces/emission.md) (path resolution), emitting skill bodies: `drive-create-project`, `drive-close-project`, `drive-deliver-workflow`, `drive-check-health`, `drive-run-retro`, `drive-start-workflow`.

**Execution modes:**

- **Walkthrough (slice-2 QA):** simulate orchestrator emit decisions at each anchor for a synthetic scenario; write the resulting JSONL. No live agent dispatch required.
- **Live run (future):** run `drive-deliver-workflow` on a real project; the trace file appears at `projects/<project-slug>/trace.jsonl`. The direct-change trace appears at `wip/drive-trace/direct-<ISO-ts>.jsonl`.

Set `LC_TRACE` to the lifecycle + cadence trace and `DC_TRACE` to the direct-change trace. For the slice-2 committed evidence:

```bash
LC_TRACE="projects/drive-instrumentation/slices/02-lifecycle-cadence-and-direct-change/qa-trace-01.jsonl"
DC_TRACE="projects/drive-instrumentation/slices/02-lifecycle-cadence-and-direct-change/qa-trace-direct-01.jsonl"
```

---

## Pre-flight (before running checks)

1. Confirm the six new emit blockquotes are present in the instrumented skill bodies:
   - `drive-create-project/SKILL.md` — `project-started` after stubs/scaffold, before the DoR gate.
   - `drive-close-project/SKILL.md` — `project-closed` at the terminal close-out-PR step (Step 9).
   - `drive-deliver-workflow/SKILL.md` — `slice-started` (Step 3) and `slice-completed` (Step 4).
   - `drive-check-health/SKILL.md` — `health-check-fired` (Step 4, after rollup renders).
   - `drive-run-retro/SKILL.md` — `retro-landed` (Step 7, after retro entry written).
2. Confirm the five emit blockquotes on `drive-start-workflow/SKILL.md` Step 5 direct-change sub-path are present (three before the `drive-dispatch` call, two after).
3. Confirm `rg "> \*\*Emit" skills-contrib/drive-dispatch/SKILL.md` returns **nothing** — `drive-dispatch` must remain uninstrumented.
4. Choose or record the scenario: at minimum one full project run (project-started → 2 slice cycles → project-closed) with an opening-rollup, per-slice-merge, and closing-rollup `health-check-fired`, at least one triggered `retro-landed`, and the mandatory-final `retro-landed`. For direct-change evidence, a separate five-event spine under a `direct-<ts>` run id.
5. If simulating, walk anchors in temporal order per the delivery workflow: `project-started` → opening rollup → `slice-started` → … → `slice-completed` → per-slice-merge → retro (if triggered) → (repeat) → closing rollup → mandatory-final retro → `project-closed`.

---

## QA checks

### Check 1 — Trace files exist at resolved paths

**Pass when:** both trace files exist at the expected paths.

| Trace | Expected path |
|---|---|
| Lifecycle + cadence | `projects/<project-slug>/trace.jsonl` (in-project runtime) or `qa-trace-01.jsonl` (slice-folder evidence) |
| Direct change | `wip/drive-trace/direct-<ISO-ts>.jsonl` (runtime) or `qa-trace-direct-01.jsonl` (slice-folder evidence) |

**Command:**

```bash
test -f "$LC_TRACE" && echo "LC exists"
test -f "$DC_TRACE" && echo "DC exists"
```

---

### Check 2 — `project-started` present and schema-valid

**Pass when:** the lifecycle trace contains at least one `project-started` event whose payload includes all required fields with correct types.

**Required fields (beyond envelope):** `project_slug` (string), `origin` (`"new-project"` | `"promote"`), `has_linear_project` (boolean).

**Envelope fields required on all events:** `event_id` (UUID), `event_type` (string), `schema_version` (`"1"`), `ts` (ISO 8601 UTC), `project_run_id` (string), `orchestrator_agent_id` (string | null).

**Command:**

```bash
rg '"event_type":"project-started"' "$LC_TRACE"
```

**Expected on pass:** one line; `origin` is `"new-project"` or `"promote"`; `has_linear_project` is `true` or `false`; `project_run_id` equals `project_slug`.

---

### Check 3 — `project-closed` present and schema-valid

**Pass when:** the lifecycle trace contains at least one `project-closed` event with all required payload fields.

**Required fields (beyond envelope):** `dod_status` (`"all-met"` | `"some-deferred"` | `"some-cancelled"`), `slices_completed` (integer ≥ 0), `final_retro_done` (boolean).

**Command:**

```bash
rg '"event_type":"project-closed"' "$LC_TRACE"
```

**Expected on pass:** one line; `dod_status` is a documented enum value; `final_retro_done` is `true` (the mandatory final retro precedes close).

---

### Check 4 — `slice-started` present and schema-valid (≥ 2 slices)

**Pass when:** the lifecycle trace contains at least two `slice-started` events, each with correct payload.

**Required fields (beyond envelope):** `slice_slug` (string), `slice_index` (integer ≥ 1, 1-based plan position), `linear_ref` (string | null).

**Command:**

```bash
rg '"event_type":"slice-started"' "$LC_TRACE"
```

**Expected on pass:** at least two lines; `slice_index` values are 1-based sequential integers matching the project plan's order.

---

### Check 5 — `slice-completed` present and schema-valid (≥ 2 slices)

**Pass when:** the lifecycle trace contains at least two `slice-completed` events, each with correct payload.

**Required fields (beyond envelope):** `slice_slug` (string, matching a prior `slice-started`), `result` (`"merged"` | `"abandoned"`), `pr_ref` (string | null).

**Command:**

```bash
rg '"event_type":"slice-completed"' "$LC_TRACE"
```

**Expected on pass:** count equals `slice-started` count; `result` is a documented enum value; `pr_ref` is non-null when `result = "merged"`.

---

### Check 6 — `health-check-fired` present and schema-valid

**Pass when:** the lifecycle trace contains at least one `health-check-fired` event with all required payload fields and a `cadence` value from the documented enum.

**Required fields (beyond envelope):** `cadence` (`"opening-rollup"` | `"per-slice-merge"` | `"closing-rollup"` | `"session-bookend"` | `"trigger-fired"`), `drift_signal_count` (integer ≥ 0), `max_drift_severity` (`"none"` | `"low"` | `"medium"` | `"high"`), `recommended_next` (string | null).

**Command:**

```bash
rg '"event_type":"health-check-fired"' "$LC_TRACE"
```

**Expected on pass:** at least one line per cadence point exercised in the scenario; `max_drift_severity` is `"none"` when `drift_signal_count = 0`.

---

### Check 7 — `retro-landed` present and schema-valid

**Pass when:** the lifecycle trace contains at least two `retro-landed` events — one triggered and one mandatory-final — each with correct payload.

**Required fields (beyond envelope):** `trigger_class` (`"dispatch-failure"` | `"drift-event"` | `"scope-shift-escapee"` | `"wip-inspection-finding"` | `"operator-flagged-surprise"` | `"mandatory-final"`), `landing_surfaces` (non-empty array of `"canonical-skill"` | `"project-context-readme"` | `"adr"`), `is_mandatory_final` (boolean).

**Command:**

```bash
rg '"event_type":"retro-landed"' "$LC_TRACE"
```

**Expected on pass:** at least two lines; mandatory-final entry has `"is_mandatory_final":true` and `"trigger_class":"mandatory-final"`; triggered entry has `is_mandatory_final:false`.

---

### Check 8 — Project/slice bookend pairing

**Pass when:** every `project-started` has a matching `project-closed` (same `project_run_id`); every `slice-started` has a matching `slice-completed` (same `slice_slug` within the same trace). An unpaired `project-started` is a recognised abandoned-setup signal and not an error for this check — but note it if present.

**Procedure:**

```bash
# Count project bookends
python3 -c "
import json
lines = [json.loads(l) for l in open('$LC_TRACE')]
starts = [e for e in lines if e['event_type']=='project-started']
closes = [e for e in lines if e['event_type']=='project-closed']
print(f'project-started: {len(starts)}, project-closed: {len(closes)}')
ss = [e['slice_slug'] for e in lines if e['event_type']=='slice-started']
sc = [e['slice_slug'] for e in lines if e['event_type']=='slice-completed']
print(f'slice-started slugs: {ss}')
print(f'slice-completed slugs: {sc}')
print(f'unpaired started: {set(ss)-set(sc)}')
print(f'unpaired completed: {set(sc)-set(ss)}')
"
```

**Expected on pass:** `project-started` count equals `project-closed` count (for a complete run); no unpaired slice slugs.

---

### Check 9 — Cadence-enum coverage

**Pass when:** every `health-check-fired.cadence` value in the lifecycle trace is one of the five documented values: `"opening-rollup"`, `"per-slice-merge"`, `"closing-rollup"`, `"session-bookend"`, `"trigger-fired"`. No undocumented cadence strings appear.

**Command:**

```bash
python3 -c "
import json
cadences = [json.loads(l)['cadence'] for l in open('$LC_TRACE')
            if json.loads(l)['event_type']=='health-check-fired']
allowed = {'opening-rollup','per-slice-merge','closing-rollup','session-bookend','trigger-fired'}
print('cadences found:', cadences)
print('illegal values:', [c for c in cadences if c not in allowed])
"
```

**Expected on pass:** no illegal values; distribution comment records counts per cadence.

---

### Check 10 — Retro-landing-only semantics

**Pass when:** `retro-landed` appears in the trace only where a retro entry was actually written (Step 7 of `drive-run-retro` must have executed). An un-triggered or un-landed retro must be silent (no `retro-landed` without a corresponding Step-7 write in the scenario).

**Procedure:** for each `retro-landed` event in the trace, confirm the walkthrough scenario describes the retro entry being appended to `retros.md` at that timestamp. Confirm the walkthrough does **not** produce a `retro-landed` for any scenario branch where `drive-run-retro` was triggered but the entry write was interrupted before Step 7.

**Expected on pass:** count of `retro-landed` events equals count of retro-entry writes in the scenario narrative. No silent retro gaps where an entry write was claimed but no event fired.

---

### Check 11 — Direct-change spine completeness

**Pass when:** the direct-change trace contains all five build-loop events (`dispatch-start`, `round-start`, `brief-issued`, `round-end`, `dispatch-end`) under a `project_run_id` matching `direct-<ISO-ts>`, with `dispatch_name` starting with `"direct-change "`, and `round_number = 1` on `round-start`.

**Command:**

```bash
python3 -c "
import json
events = [json.loads(l) for l in open('$DC_TRACE')]
types = [e['event_type'] for e in events]
required = ['dispatch-start','round-start','brief-issued','round-end','dispatch-end']
print('event_types:', types)
print('missing:', [t for t in required if t not in types])
rid = events[0].get('project_run_id','')
print('project_run_id:', rid, '→ starts with direct-:', rid.startswith('direct-'))
ds = next((e for e in events if e['event_type']=='dispatch-start'), None)
print('dispatch_name:', ds['dispatch_name'] if ds else 'MISSING')
rs = next((e for e in events if e['event_type']=='round-start'), None)
print('round_number:', rs['round_number'] if rs else 'MISSING')
"
```

**Expected on pass:** all five types present in order; `project_run_id` starts with `direct-`; `dispatch_name` starts with `"direct-change "`; `round_number = 1`; `parent_dispatch_id = null` on `dispatch-start`; `brief_disposition = "initial"` on `brief-issued`; `verdict = "satisfied"` and `result = "completed"` for a successful one-shot run.

---

### Check 12 — `drive-dispatch` stays-clean grep gate

**Pass when:** `rg "> \*\*Emit" skills-contrib/drive-dispatch/SKILL.md` returns **nothing**. `drive-dispatch` is deliberately uninstrumented (per slice-2 spec § "`drive-dispatch` stays uninstrumented"); all emit-sites live with the calling orchestrators.

**Command (run from repo root):**

```bash
rg "> \*\*Emit" skills-contrib/drive-dispatch/SKILL.md \
  && echo "FAIL: drive-dispatch has emit-sites" \
  || echo "PASS: drive-dispatch is clean"
```

**Expected on pass:** exit 1 from `rg` (no match); the `|| echo` branch prints `PASS`.

---

### Check 13 — Payload-shape conformance (all events)

**Pass when:** every event line in both traces validates against its `events.md` schema (field presence, types, enum values). Hand-check or script via `jq` / `python3`.

**Command:**

```bash
# Validate every line parses + has required envelope fields
python3 -c "
import json, sys
required_envelope = {'event_id','event_type','schema_version','ts','project_run_id','orchestrator_agent_id'}
errors = []
for path in ['$LC_TRACE','$DC_TRACE']:
  for i, line in enumerate(open(path), 1):
    e = json.loads(line)
    missing = required_envelope - set(e.keys())
    if missing:
      errors.append(f'{path}:{i} missing envelope fields: {missing}')
    if e.get('schema_version') != '1':
      errors.append(f'{path}:{i} schema_version != \"1\": {e.get(\"schema_version\")}')
if errors:
  for err in errors: print('FAIL:', err)
  sys.exit(1)
print('PASS: all envelope fields present and schema_version=\"1\" on every line')
"
```

**Per-event-type spot-check (manual):** for each line, verify the key set equals envelope + the documented payload fields for that `event_type` (see `events.md` §§ by event name). No extra top-level keys; no missing required fields.

---

## Expected-trace section

### `qa-trace-01.jsonl` — lifecycle + cadence arc

Twelve events in temporal order. `project_run_id = "sample-feature"`.

| # | `event_type` | `ts` | Key payload values |
|---|---|---|---|
| 1 | `project-started` | T08:00 | `origin:"new-project"`, `has_linear_project:true` |
| 2 | `health-check-fired` | T08:05 | `cadence:"opening-rollup"`, `drift_signal_count:0` |
| 3 | `slice-started` | T08:10 | `slice_slug:"01-initial-scaffolding"`, `slice_index:1` |
| 4 | `slice-completed` | T10:20 | `slice_slug:"01-initial-scaffolding"`, `result:"merged"` |
| 5 | `health-check-fired` | T10:22 | `cadence:"per-slice-merge"`, `drift_signal_count:1` |
| 6 | `retro-landed` | T10:30 | `trigger_class:"drift-event"`, `is_mandatory_final:false` |
| 7 | `slice-started` | T10:40 | `slice_slug:"02-core-logic"`, `slice_index:2` |
| 8 | `slice-completed` | T14:00 | `slice_slug:"02-core-logic"`, `result:"merged"` |
| 9 | `health-check-fired` | T14:05 | `cadence:"per-slice-merge"`, `drift_signal_count:0` |
| 10 | `health-check-fired` | T14:20 | `cadence:"closing-rollup"`, `drift_signal_count:0` |
| 11 | `retro-landed` | T14:40 | `trigger_class:"mandatory-final"`, `is_mandatory_final:true` |
| 12 | `project-closed` | T15:00 | `dod_status:"all-met"`, `slices_completed:2`, `final_retro_done:true` |

### `qa-trace-direct-01.jsonl` — direct-change spine

Five events. `project_run_id = "direct-2026-05-29T09:30:00Z"`. All share `dispatch_id = "d9000001-0009-4009-8009-000000000001"`.

| # | `event_type` | `ts` | Key payload values |
|---|---|---|---|
| 1 | `dispatch-start` | T09:30:00 | `dispatch_name:"direct-change tml-9999"`, `parent_dispatch_id:null` |
| 2 | `round-start` | T09:30:01 | `round_number:1` |
| 3 | `brief-issued` | T09:30:02 | `brief_disposition:"initial"`, `brief_byte_length:1792` |
| 4 | `round-end` | T10:15:00 | `verdict:"satisfied"`, `wall_clock_ms:2699000` |
| 5 | `dispatch-end` | T10:15:01 | `result:"completed"`, `wall_clock_ms:2701000` |

---

## Run report template

After executing checks, write `qa-run-01.md` with:

- Date and runner
- Scenario description (timeline summary table)
- Pass/fail per check (1–13)
- Hand-computation tables for the four slice-2 signals (project wall-clock, per-slice wall-clock, health-check cadence distribution, retro trigger distribution + direct-change visibility)
- Behaviour-preservation read-through across all six newly instrumented skill bodies + the direct-change sub-path
- Concluding status: `no unresolved 🛑 Blocker findings` or list blockers

Commit `qa-trace-01.jsonl` and `qa-trace-direct-01.jsonl` alongside the matching run report as structural evidence.
