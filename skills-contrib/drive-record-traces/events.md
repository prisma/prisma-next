# Drive trace event vocabulary

## At a glance

Versioned event vocabulary for Drive orchestrator instrumentation. Every instrumented skill emits structured events to a project-scoped `trace.jsonl` file (see [`emission.md`](./emission.md) for path resolution and append protocol). Slice 1 ships eleven event types: five on the build-loop dispatch/round spine and six on the planning chain (spec/plan authoring, triage, I12 halts). Slice 2 adds six lifecycle/cadence event types (project + slice bookends, health-check cadence, retro landing), bringing the total to **seventeen**. Later slices extend the vocabulary without breaking readers that honour `schema_version`.

**Vocabulary version:** `schema_version: "1"`.

**Consumers:** instrumented `drive-*` skill bodies (emit-side construction), slice-3 read-time validators, manual QA, and future metric harnesses.

## File shape

Each event is one JSON object on its own line in `trace.jsonl`. Events share a common envelope; each event type adds payload fields at the top level of the same object (flat merge — no nested `payload` wrapper). Order in the file is canonical; `ts` is not guaranteed monotonic across re-entrant skills.

## Common envelope

Every event carries these fields:

| Field | Type | Meaning |
|---|---|---|
| `event_id` | UUID v4 | Unique per event; assigned at emit time. |
| `event_type` | string | One of the documented event-type names. Build loop: `dispatch-start`, `dispatch-end`, `round-start`, `round-end`, `brief-issued`. Planning chain: `spec-authored`, `spec-amended`, `plan-authored`, `plan-amended`, `triage-verdict`, `falsified-assumption`. Lifecycle / cadence: `project-started`, `project-closed`, `slice-started`, `slice-completed`, `health-check-fired`, `retro-landed`. |
| `schema_version` | string | Vocabulary version. Slice 1 ships `"1"`. |
| `ts` | ISO 8601 UTC string | Wall-clock at emit time. |
| `project_run_id` | string | Stable identifier for the ProjectRun this event belongs to. Format: project slug for in-project work (e.g. `sample-project`); `orphan-<slice-slug>` for orphan slices; `direct-<ISO-ts>` for direct changes. Slice 1 hard-codes this per emission site from orchestrator context; automated detection is a later-slice concern. |
| `orchestrator_agent_id` | string \| null | Cursor session UUID when knowable from environment / SDK. Slice 1 emits `null` when not reachable from inside the skill body. |

## Event types (build loop)

Payload-only fields below; merge with the common envelope at emit time.

### `dispatch-start`

Fires once per dispatch, before the implementer `Task` call (orchestrator pre-delegation).

| Field | Type | Meaning |
|---|---|---|
| `dispatch_id` | UUID v4 | New per dispatch; referenced by every following event in this dispatch. |
| `dispatch_name` | string | Operator-authored short descriptor (e.g. `"implementer D1 R1"`). |
| `subagent_type` | string | Cursor `Task` `subagent_type` field passed through verbatim. |
| `model` | string \| null | Model name passed to `Task`; null when unspecified. |
| `parent_dispatch_id` | UUID \| null | When the dispatch resumes a prior subagent (e.g. round 2), points to that dispatch's `dispatch_id`. When resuming a cross-slice persistent subagent, points to the most recent prior dispatch ID for that subagent. |

### `dispatch-end`

Fires once per dispatch when the dispatch closes (`SATISFIED` with no further dispatches, or on `aborted` / `failed` stop conditions).

| Field | Type | Meaning |
|---|---|---|
| `dispatch_id` | UUID | Same `dispatch_id` as the corresponding `dispatch-start`. |
| `result` | enum | `"completed"` \| `"failed"` \| `"aborted"`. `completed` = subagent returned with the delegation finished (reviewer verdict is recorded on `round-end`); `failed` = subagent surfaced a stop condition; `aborted` = orchestrator killed the dispatch (e.g. WIP-inspection drift). |
| `wall_clock_ms` | integer | Milliseconds between `dispatch-start.ts` and this event's `ts`. |

### `round-start`

Fires once per round after DoR passes and before brief assembly. Per-round temporal sequence: `round-start` → `brief-issued` → delegate `Task` call → `round-end`.

| Field | Type | Meaning |
|---|---|---|
| `dispatch_id` | UUID | The enclosing dispatch. |
| `round_id` | UUID v4 | New per round; referenced by `round-end` and by `brief-issued` for this round. |
| `round_number` | integer (1-indexed) | Sequential within `dispatch_id`. Each implementer→reviewer→triage cycle is one round. |

### `round-end`

Fires once per round after the orchestrator's triage verdict is recorded.

| Field | Type | Meaning |
|---|---|---|
| `dispatch_id` | UUID | Same as the enclosing `dispatch-start`. |
| `round_id` | UUID | Same as the corresponding `round-start`. |
| `verdict` | enum | `"satisfied"` \| `"another-round-needed"` \| `"escalating-to-user"` \| `"stop-condition"`. Matches reviewer verdict per `drive-build-workflow` loop step 7. `"stop-condition"` covers I12 halt-and-route-to-discussion cases where review did not issue a verdict. |
| `findings_filed` | integer | Count of new findings filed in `code-review.md § Findings log` this round (best-effort orchestrator-side observation). |
| `wall_clock_ms` | integer | Milliseconds between `round-start.ts` and this event's `ts`. |

### `brief-issued`

Fires once per round when the implementer brief is finalised, immediately before the `Task` call. Slice 1 tracks only the implementer brief (not reviewer delegations).

| Field | Type | Meaning |
|---|---|---|
| `dispatch_id` | UUID | The enclosing dispatch. |
| `round_id` | UUID | The round whose delegation this brief feeds. |
| `brief_byte_length` | integer | UTF-8 byte length of the assembled brief. |
| `brief_content_hash` | string (sha256 hex) | Hash of the assembled brief; cross-round diffs identify verbatim reissue vs amendment. |
| `brief_disposition` | enum | `"initial"` \| `"reissue"` \| `"amended"`. `initial` = first brief for this dispatch; `reissue` = same hash as a prior brief in this dispatch; `amended` = different hash from prior briefs in this dispatch. |

## Event types (planning chain)

Payload-only fields below; merge with the common envelope at emit time. Spec/plan write events use the existence-check pattern in [`emission.md`](./emission.md) § Existence-check pattern.

### `spec-authored`

**Trigger.** The orchestrator commits a spec file to disk for the first time (target path did not exist immediately before write).

**Emitting skills.** `drive-specify-project`, `drive-specify-slice`.

| Field | Type | Meaning |
|---|---|---|
| `spec_path` | string | Repo-relative path to the spec file written (e.g. `projects/<slug>/spec.md`). |
| `spec_kind` | enum | `"project"` \| `"slice"`. |
| `byte_length` | integer | UTF-8 byte length of the spec body written. |
| `edge_cases_count` | integer \| null | Count of pre-named edge cases in a slice spec; `null` for project specs. |
| `open_questions_count` | integer | Count of open questions in the spec at write time. |
| `dod_items_count` | integer | Count of Definition-of-Done checklist items in the spec at write time. |

#### JSONL example

```jsonl
{"event_id":"p1000001-0001-4001-8001-000000000001","event_type":"spec-authored","schema_version":"1","ts":"2026-05-28T10:00:00.000Z","project_run_id":"sample-project","orchestrator_agent_id":null,"spec_path":"projects/sample-project/spec.md","spec_kind":"project","byte_length":8192,"edge_cases_count":null,"open_questions_count":5,"dod_items_count":8}
```

### `spec-amended`

**Trigger.** The orchestrator commits a spec file that already existed immediately before write.

**Emitting skills.** `drive-specify-project`, `drive-specify-slice`.

| Field | Type | Meaning |
|---|---|---|
| `spec_path` | string | Repo-relative path to the amended spec. |
| `spec_kind` | enum | `"project"` \| `"slice"`. |
| `byte_length` | integer | UTF-8 byte length after amendment. |
| `bytes_delta` | integer (signed) | Change in byte length vs the prior on-disk version (`new − old`). |
| `edge_cases_count` | integer \| null | Slice specs only; `null` for project specs. |
| `open_questions_count` | integer | Count after amendment. |
| `dod_items_count` | integer | Count after amendment. |
| `reason` | enum | `"falsified-assumption"` \| `"new-edge-case"` \| `"scope-shift"` \| `"operator-correction"` \| `"replan-from-discussion"`. |
| `sections_changed` | string[] | Headings or section identifiers touched (best-effort orchestrator observation). |

#### JSONL example

```jsonl
{"event_id":"p1000002-0001-4001-8001-000000000002","event_type":"spec-amended","schema_version":"1","ts":"2026-05-28T11:00:00.000Z","project_run_id":"sample-project","orchestrator_agent_id":null,"spec_path":"projects/sample-project/spec.md","spec_kind":"project","byte_length":9216,"bytes_delta":1024,"edge_cases_count":null,"open_questions_count":4,"dod_items_count":8,"reason":"falsified-assumption","sections_changed":["Approach","Edge cases"]}
```

#### Notes

A same-session re-write of a spec just authored emits `spec-amended` (existence-check sees the file present). `falsified-assumption` and `spec-amended` correlate by timestamp + `spec_path`, not by an explicit causation ID.

### `plan-authored`

**Trigger.** The orchestrator commits a plan file to disk for the first time.

**Emitting skills.** `drive-plan-project`, `drive-plan-slice`.

| Field | Type | Meaning |
|---|---|---|
| `plan_path` | string | Repo-relative path to the plan file written. |
| `plan_kind` | enum | `"project"` \| `"slice"`. |
| `byte_length` | integer | UTF-8 byte length of the plan body written. |
| `dispatch_count` | integer \| null | Number of dispatches in a slice plan; `null` for project plans. |
| `slice_count` | integer \| null | Number of slices in a project plan; `null` for slice plans. |
| `dispatch_size_distribution` | object \| null | Slice plans only: `{"S": n, "M": n, "L": n, "XL": n}` dispatch size counts; `null` for project plans. |
| `open_items_count` | integer | Count of open / TBD items in the plan at write time. |

#### JSONL example

```jsonl
{"event_id":"p2000001-0002-4002-8002-000000000001","event_type":"plan-authored","schema_version":"1","ts":"2026-05-28T10:30:00.000Z","project_run_id":"sample-project","orchestrator_agent_id":null,"plan_path":"projects/sample-project/slices/01-trace-vocab-and-build-instrumentation/plan.md","plan_kind":"slice","byte_length":4096,"dispatch_count":6,"slice_count":null,"dispatch_size_distribution":{"S":0,"M":6,"L":0,"XL":0},"open_items_count":2}
```

### `plan-amended`

**Trigger.** The orchestrator commits a plan file that already existed immediately before write.

**Emitting skills.** `drive-plan-project`, `drive-plan-slice`.

| Field | Type | Meaning |
|---|---|---|
| `plan_path` | string | Repo-relative path to the amended plan. |
| `plan_kind` | enum | `"project"` \| `"slice"`. |
| `byte_length` | integer | UTF-8 byte length after amendment. |
| `bytes_delta` | integer (signed) | Change in byte length vs the prior on-disk version. |
| `dispatch_count` | integer \| null | Slice plans only; `null` for project plans. |
| `slice_count` | integer \| null | Project plans only; `null` for slice plans. |
| `dispatch_size_distribution` | object \| null | Slice plans only; `null` for project plans. |
| `open_items_count` | integer | Count after amendment. |
| `reason` | enum | `"falsified-assumption"` \| `"new-edge-case"` \| `"scope-shift"` \| `"operator-correction"` \| `"replan-from-discussion"` \| `"dispatch-resize"` \| `"dispatch-added"` \| `"dispatch-removed"`. |
| `dispatches_added` | integer \| null | Slice plans only: count of dispatches added; `null` for project plans. |
| `dispatches_removed` | integer \| null | Slice plans only: count of dispatches removed; `null` for project plans. |
| `dispatches_resized` | integer \| null | Slice plans only: count of dispatches whose size label changed; `null` for project plans. |

#### JSONL example

```jsonl
{"event_id":"p2000002-0002-4002-8002-000000000002","event_type":"plan-amended","schema_version":"1","ts":"2026-05-28T12:00:00.000Z","project_run_id":"sample-project","orchestrator_agent_id":null,"plan_path":"projects/sample-project/slices/01-trace-vocab-and-build-instrumentation/plan.md","plan_kind":"slice","byte_length":5120,"bytes_delta":1024,"dispatch_count":7,"slice_count":null,"dispatch_size_distribution":{"S":0,"M":7,"L":0,"XL":0},"open_items_count":1,"reason":"dispatch-added","dispatches_added":1,"dispatches_removed":0,"dispatches_resized":0}
```

### `triage-verdict`

**Trigger.** `drive-triage-work` returns a verdict to its caller (fresh entry or mid-flight re-triage).

**Emitting skills.** `drive-triage-work`.

| Field | Type | Meaning |
|---|---|---|
| `verdict` | enum | `"direct-change"` \| `"orphan-slice"` \| `"in-project-slice"` \| `"new-project"` \| `"promote"` \| `"demote"` \| `"spike-first"` \| `"defer"`. |
| `input_shape` | enum | `"linear-ticket"` \| `"chat-ask"` \| `"customer-ask"` \| `"bug-report"` \| `"mid-flight-scope-signal"` \| `"i-should-do-x-thought"`. |
| `input_ref` | string \| null | Linear ticket ID when available (e.g. `TML-2704`); else `null`. |

#### JSONL example

```jsonl
{"event_id":"p3000001-0003-4003-8003-000000000001","event_type":"triage-verdict","schema_version":"1","ts":"2026-05-28T09:00:00.000Z","project_run_id":"sample-project","orchestrator_agent_id":null,"verdict":"in-project-slice","input_shape":"linear-ticket","input_ref":"TML-2704"}
```

#### Notes

Re-triage (e.g. promote ceremony) emits a second event with the same `input_ref` when applicable; triage stability metrics count events per ticket.

### `falsified-assumption`

**Trigger.** `drive-discussion` is entered for a mid-flight I12 falsified-assumption halt only. Pre-spec design, mid-spec forks, unplanned obstacles, and operator-requested discussion do **not** emit this event in slice 1.

**Emitting skills.** `drive-discussion` (conditional on I12 trigger).

| Field | Type | Meaning |
|---|---|---|
| `artifact_path` | string | Repo-relative path to the spec or plan whose load-bearing assumption was falsified. |
| `triggered_by` | enum | `"implementer-pushback"` \| `"wip-inspection"` \| `"dispatch-blocked"` \| `"health-check-drift"` \| `"orchestrator-self-detected"` \| `"operator-flagged"`. |
| `assumption_summary` | string \| null | One-sentence summary of the falsified assumption; `null` when not summarised at emit time. |

#### JSONL example

```jsonl
{"event_id":"p4000001-0004-4004-8004-000000000001","event_type":"falsified-assumption","schema_version":"1","ts":"2026-05-28T11:30:00.000Z","project_run_id":"sample-project","orchestrator_agent_id":null,"artifact_path":"projects/sample-project/spec.md","triggered_by":"implementer-pushback","assumption_summary":"Canonical skill path was .agents/skills/ not skills-contrib/"}
```

#### Notes

The event fires even when the downstream spec/plan amendment is deferred to the operator; spec-amendment-rate metrics must not assume 1:1 pairing with `falsified-assumption` counts.

## Event types (lifecycle + cadence)

Payload-only fields below; merge with the common envelope at emit time.

### `project-started`

**Trigger.** `drive-create-project` fires this once after the project workspace is scaffolded, immediately before the DoR gate. `project_run_id` equals `project_slug` for all events in this project's trace.

**Emitting skills.** `drive-create-project`.

| Field | Type | Meaning |
|---|---|---|
| `project_slug` | string | The project's slug identifier (also used as `project_run_id`). |
| `origin` | enum | `"new-project"` \| `"promote"`. `new-project` = freshly created; `promote` = promoted from an orphan slice. |
| `has_linear_project` | boolean | Whether a Linear project was linked at creation time. |

#### JSONL example

```jsonl
{"event_id":"e5000001-0005-4005-8005-000000000001","event_type":"project-started","schema_version":"1","ts":"2026-05-29T08:00:00.000Z","project_run_id":"my-new-project","orchestrator_agent_id":null,"project_slug":"my-new-project","origin":"new-project","has_linear_project":true}
```

### `project-closed`

**Trigger.** `drive-close-project` fires this once at the terminal close-out step (close-out PR opened).

**Emitting skills.** `drive-close-project`.

| Field | Type | Meaning |
|---|---|---|
| `dod_status` | enum | `"all-met"` \| `"some-deferred"` \| `"some-cancelled"`. Overall DoD outcome at close. |
| `slices_completed` | integer ≥ 0 | Count of slices that reached `slice-completed.result = "merged"`. |
| `final_retro_done` | boolean | Whether the mandatory final retro was completed and landed before close. |

> **Note.** Project wall-clock (total project duration) is **read-side**: compute it as `project-closed.ts − project-started.ts` from the trace file. It is not emitted because the two events routinely span sessions and the orchestrator does not hold `project-started.ts` at close time.

#### JSONL example

```jsonl
{"event_id":"e5000002-0005-4005-8005-000000000002","event_type":"project-closed","schema_version":"1","ts":"2026-06-15T16:00:00.000Z","project_run_id":"my-new-project","orchestrator_agent_id":null,"dod_status":"all-met","slices_completed":3,"final_retro_done":true}
```

### `slice-started`

**Trigger.** `drive-deliver-workflow` fires this once per slice, immediately before invoking `drive-build-workflow` for the picked slice (Step 3 of the delivery workflow).

**Emitting skills.** `drive-deliver-workflow`.

| Field | Type | Meaning |
|---|---|---|
| `slice_slug` | string | The slice's slug identifier (matches the slice directory name). |
| `slice_index` | integer ≥ 1 | 1-based position of this slice in the project plan. |
| `linear_ref` | string \| null | Linear issue reference (e.g. `TML-2711`) when the slice was sourced from a Linear ticket; `null` otherwise. |

#### JSONL example

```jsonl
{"event_id":"e5000003-0005-4005-8005-000000000003","event_type":"slice-started","schema_version":"1","ts":"2026-05-29T09:00:00.000Z","project_run_id":"my-new-project","orchestrator_agent_id":null,"slice_slug":"01-initial-scaffolding","slice_index":1,"linear_ref":"TML-2711"}
```

### `slice-completed`

**Trigger.** `drive-deliver-workflow` fires this once per slice, after the slice PR merges (or is abandoned).

**Emitting skills.** `drive-deliver-workflow`.

| Field | Type | Meaning |
|---|---|---|
| `slice_slug` | string | The slice's slug identifier; matches the corresponding `slice-started` event. |
| `result` | enum | `"merged"` \| `"abandoned"`. `merged` = PR landed; `abandoned` = slice dropped without merging. |
| `pr_ref` | string \| null | PR reference (e.g. `#42`) when a PR was opened; `null` if the slice was abandoned before a PR was created. |

#### JSONL example

```jsonl
{"event_id":"e5000004-0005-4005-8005-000000000004","event_type":"slice-completed","schema_version":"1","ts":"2026-05-30T14:30:00.000Z","project_run_id":"my-new-project","orchestrator_agent_id":null,"slice_slug":"01-initial-scaffolding","result":"merged","pr_ref":"#42"}
```

### `health-check-fired`

**Trigger.** `drive-check-health` fires this once per rollup, after the rollup renders (Step 4 of the health-check skill).

**Emitting skills.** `drive-check-health`.

| Field | Type | Meaning |
|---|---|---|
| `cadence` | enum | `"opening-rollup"` \| `"per-slice-merge"` \| `"closing-rollup"` \| `"session-bookend"` \| `"trigger-fired"`. Identifies which cadence point triggered the health check; `trigger-fired` covers operator-initiated invocations outside the standard cadence. |
| `drift_signal_count` | integer ≥ 0 | Count of drift signals detected in this rollup. |
| `max_drift_severity` | enum | `"none"` \| `"low"` \| `"medium"` \| `"high"`. Highest severity across all drift signals in this rollup; `"none"` when `drift_signal_count = 0`. |
| `recommended_next` | string \| null | The health check's recommended next action, if any; `null` when no recommendation was generated. |

#### JSONL example

```jsonl
{"event_id":"e5000005-0005-4005-8005-000000000005","event_type":"health-check-fired","schema_version":"1","ts":"2026-05-30T14:32:00.000Z","project_run_id":"my-new-project","orchestrator_agent_id":null,"cadence":"per-slice-merge","drift_signal_count":2,"max_drift_severity":"low","recommended_next":"Review scope changes before starting slice 2."}
```

### `retro-landed`

**Trigger.** `drive-run-retro` fires this once per retro, after the retro entry is appended to a memory-strong landing surface (Step 7 of the retro skill). An un-landed retro is silent — this event fires only on landing.

**Emitting skills.** `drive-run-retro`.

| Field | Type | Meaning |
|---|---|---|
| `trigger_class` | enum | `"dispatch-failure"` \| `"drift-event"` \| `"scope-shift-escapee"` \| `"wip-inspection-finding"` \| `"operator-flagged-surprise"` \| `"mandatory-final"`. The condition that triggered this retro. |
| `landing_surfaces` | array of enum | One or more of `"canonical-skill"`, `"project-context-readme"`, `"adr"`. The surfaces to which the retro output was appended. |
| `is_mandatory_final` | boolean | Whether this is the mandatory final retro at project close. When `true`, `trigger_class` is always `"mandatory-final"`. |

> **Note.** This event fires only on landing; an un-landed retro (process failure before Step 7) is silent. Slice-3 assertions can infer un-landed retros by finding a health-check retro trigger with no matching `retro-landed`.

#### JSONL example

```jsonl
{"event_id":"e5000006-0005-4005-8005-000000000006","event_type":"retro-landed","schema_version":"1","ts":"2026-05-30T15:00:00.000Z","project_run_id":"my-new-project","orchestrator_agent_id":null,"trigger_class":"dispatch-failure","landing_surfaces":["canonical-skill","adr"],"is_mandatory_final":false}
```

## Machine-readable schema

The TypeScript arktype definitions for all event types live in [`skills-contrib/drive-record-traces/schema.ts`](./schema.ts). That file is the single source of truth; `skills-contrib/drive-diagnose-run/schema.ts` is a vendored copy kept in sync by the `schema-parity` test in `skills-contrib/drive-diagnose-run/test/schema-parity.test.ts`.

## JSONL examples

One example line per slice-1 event type (build loop, then planning chain). Payload values are illustrative.

```jsonl
{"event_id":"a1b2c3d4-e5f6-4789-a012-3456789abcde","event_type":"dispatch-start","schema_version":"1","ts":"2026-05-28T14:00:00.000Z","project_run_id":"sample-project","orchestrator_agent_id":null,"dispatch_id":"b2c3d4e5-f6a7-4890-b123-456789abcdef","dispatch_name":"implementer D1 R1","subagent_type":"generalPurpose","model":"composer-2.5-fast","parent_dispatch_id":null}
{"event_id":"c3d4e5f6-a7b8-4901-c234-56789abcdef0","event_type":"round-start","schema_version":"1","ts":"2026-05-28T14:00:01.000Z","project_run_id":"sample-project","orchestrator_agent_id":null,"dispatch_id":"b2c3d4e5-f6a7-4890-b123-456789abcdef","round_id":"d4e5f6a7-b8c9-4012-d345-6789abcdef01","round_number":1}
{"event_id":"e5f6a7b8-c9d0-4123-e456-789abcdef012","event_type":"brief-issued","schema_version":"1","ts":"2026-05-28T14:00:02.000Z","project_run_id":"sample-project","orchestrator_agent_id":null,"dispatch_id":"b2c3d4e5-f6a7-4890-b123-456789abcdef","round_id":"d4e5f6a7-b8c9-4012-d345-6789abcdef01","brief_byte_length":4096,"brief_content_hash":"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08","brief_disposition":"initial"}
{"event_id":"f6a7b8c9-d0e1-4234-f567-89abcdef0123","event_type":"round-end","schema_version":"1","ts":"2026-05-28T15:30:00.000Z","project_run_id":"sample-project","orchestrator_agent_id":null,"dispatch_id":"b2c3d4e5-f6a7-4890-b123-456789abcdef","round_id":"d4e5f6a7-b8c9-4012-d345-6789abcdef01","verdict":"satisfied","findings_filed":0,"wall_clock_ms":5399000}
{"event_id":"a7b8c9d0-e1f2-4345-a678-9abcdef01234","event_type":"dispatch-end","schema_version":"1","ts":"2026-05-28T15:30:01.000Z","project_run_id":"sample-project","orchestrator_agent_id":null,"dispatch_id":"b2c3d4e5-f6a7-4890-b123-456789abcdef","result":"completed","wall_clock_ms":5401000}
{"event_id":"p1000001-0001-4001-8001-000000000001","event_type":"spec-authored","schema_version":"1","ts":"2026-05-28T10:00:00.000Z","project_run_id":"sample-project","orchestrator_agent_id":null,"spec_path":"projects/sample-project/spec.md","spec_kind":"project","byte_length":8192,"edge_cases_count":null,"open_questions_count":5,"dod_items_count":8}
{"event_id":"p1000002-0001-4001-8001-000000000002","event_type":"spec-amended","schema_version":"1","ts":"2026-05-28T11:00:00.000Z","project_run_id":"sample-project","orchestrator_agent_id":null,"spec_path":"projects/sample-project/spec.md","spec_kind":"project","byte_length":9216,"bytes_delta":1024,"edge_cases_count":null,"open_questions_count":4,"dod_items_count":8,"reason":"falsified-assumption","sections_changed":["Approach","Edge cases"]}
{"event_id":"p2000001-0002-4002-8002-000000000001","event_type":"plan-authored","schema_version":"1","ts":"2026-05-28T10:30:00.000Z","project_run_id":"sample-project","orchestrator_agent_id":null,"plan_path":"projects/sample-project/plan.md","plan_kind":"project","byte_length":6144,"dispatch_count":null,"slice_count":3,"dispatch_size_distribution":null,"open_items_count":1}
{"event_id":"p2000002-0002-4002-8002-000000000002","event_type":"plan-amended","schema_version":"1","ts":"2026-05-28T12:00:00.000Z","project_run_id":"sample-project","orchestrator_agent_id":null,"plan_path":"projects/sample-project/slices/01-trace-vocab-and-build-instrumentation/plan.md","plan_kind":"slice","byte_length":5120,"bytes_delta":1024,"dispatch_count":7,"slice_count":null,"dispatch_size_distribution":{"S":0,"M":7,"L":0,"XL":0},"open_items_count":1,"reason":"dispatch-added","dispatches_added":1,"dispatches_removed":0,"dispatches_resized":0}
{"event_id":"p3000001-0003-4003-8003-000000000001","event_type":"triage-verdict","schema_version":"1","ts":"2026-05-28T09:00:00.000Z","project_run_id":"sample-project","orchestrator_agent_id":null,"verdict":"in-project-slice","input_shape":"linear-ticket","input_ref":"TML-2704"}
{"event_id":"p4000001-0004-4004-8004-000000000001","event_type":"falsified-assumption","schema_version":"1","ts":"2026-05-28T11:30:00.000Z","project_run_id":"sample-project","orchestrator_agent_id":null,"artifact_path":"projects/sample-project/spec.md","triggered_by":"implementer-pushback","assumption_summary":"Canonical skill path was .agents/skills/ not skills-contrib/"}
{"event_id":"e5000001-0005-4005-8005-000000000001","event_type":"project-started","schema_version":"1","ts":"2026-05-29T08:00:00.000Z","project_run_id":"my-new-project","orchestrator_agent_id":null,"project_slug":"my-new-project","origin":"new-project","has_linear_project":true}
{"event_id":"e5000002-0005-4005-8005-000000000002","event_type":"project-closed","schema_version":"1","ts":"2026-06-15T16:00:00.000Z","project_run_id":"my-new-project","orchestrator_agent_id":null,"dod_status":"all-met","slices_completed":3,"final_retro_done":true}
{"event_id":"e5000003-0005-4005-8005-000000000003","event_type":"slice-started","schema_version":"1","ts":"2026-05-29T09:00:00.000Z","project_run_id":"my-new-project","orchestrator_agent_id":null,"slice_slug":"01-initial-scaffolding","slice_index":1,"linear_ref":"TML-2711"}
{"event_id":"e5000004-0005-4005-8005-000000000004","event_type":"slice-completed","schema_version":"1","ts":"2026-05-30T14:30:00.000Z","project_run_id":"my-new-project","orchestrator_agent_id":null,"slice_slug":"01-initial-scaffolding","result":"merged","pr_ref":"#42"}
{"event_id":"e5000005-0005-4005-8005-000000000005","event_type":"health-check-fired","schema_version":"1","ts":"2026-05-30T14:32:00.000Z","project_run_id":"my-new-project","orchestrator_agent_id":null,"cadence":"per-slice-merge","drift_signal_count":2,"max_drift_severity":"low","recommended_next":"Review scope changes before starting slice 2."}
{"event_id":"e5000006-0005-4005-8005-000000000006","event_type":"retro-landed","schema_version":"1","ts":"2026-05-30T15:00:00.000Z","project_run_id":"my-new-project","orchestrator_agent_id":null,"trigger_class":"dispatch-failure","landing_surfaces":["canonical-skill","adr"],"is_mandatory_final":false}
```

## References

- Machine-readable schema (arktype definitions): [`schema.ts`](./schema.ts).
- Emission protocol (path resolution, append mechanics): [`emission.md`](./emission.md).
- This skill's overview + the list of instrumented skills: [`SKILL.md`](./SKILL.md).
- Brief shape the `brief-issued` event measures: the Drive `brief-discipline` principle doc.
- Build-loop emitter: the `drive-build-workflow` skill.
