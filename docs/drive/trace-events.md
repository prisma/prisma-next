# Drive trace event vocabulary

## At a glance

Versioned event vocabulary for Drive orchestrator instrumentation. Every instrumented skill emits structured events to a project-scoped `trace.jsonl` file (see [`trace-emission.md`](./trace-emission.md) for path resolution and append protocol). Slice 1 ships eleven event types: five on the build-loop dispatch/round spine and six on the planning chain (spec/plan authoring, triage, I12 halts). Later slices extend the vocabulary without breaking readers that honour `schema_version`.

**Vocabulary version:** `schema_version: "1"`.

**Consumers:** instrumented `drive-*` skill bodies (emit-side construction), slice-3 read-time validators, manual QA, and future metric harnesses.

## File shape

Each event is one JSON object on its own line in `trace.jsonl`. Events share a common envelope; each event type adds payload fields at the top level of the same object (flat merge — no nested `payload` wrapper). Order in the file is canonical; `ts` is not guaranteed monotonic across re-entrant skills.

## Common envelope

Every event carries these fields:

| Field | Type | Meaning |
|---|---|---|
| `event_id` | UUID v4 | Unique per event; assigned at emit time. |
| `event_type` | string | One of the documented event-type names. Build loop: `dispatch-start`, `dispatch-end`, `round-start`, `round-end`, `brief-issued`. Planning chain: `spec-authored`, `spec-amended`, `plan-authored`, `plan-amended`, `triage-verdict`, `falsified-assumption`. |
| `schema_version` | string | Vocabulary version. Slice 1 ships `"1"`. |
| `ts` | ISO 8601 UTC string | Wall-clock at emit time. |
| `project_run_id` | string | Stable identifier for the ProjectRun this event belongs to. Format: project slug for in-project work (e.g. `drive-instrumentation`); `orphan-<slice-slug>` for orphan slices; `direct-<ISO-ts>` for direct changes. Slice 1 hard-codes this per emission site from orchestrator context; automated detection is a later-slice concern. |
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

Payload-only fields below; merge with the common envelope at emit time. Spec/plan write events use the existence-check pattern in [`trace-emission.md`](./trace-emission.md) § Existence-check pattern.

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

#### Arktype

```typescript
export const SpecAuthoredEvent = type({
  ...envelopeFields,
  event_type: '"spec-authored"',
  spec_path: 'string',
  spec_kind: '"project" | "slice"',
  byte_length: 'number.integer>=0',
  edge_cases_count: 'number.integer>=0 | null',
  open_questions_count: 'number.integer>=0',
  dod_items_count: 'number.integer>=0',
});
```

#### JSONL example

```jsonl
{"event_id":"p1000001-0001-4001-8001-000000000001","event_type":"spec-authored","schema_version":"1","ts":"2026-05-28T10:00:00.000Z","project_run_id":"drive-instrumentation","orchestrator_agent_id":null,"spec_path":"projects/drive-instrumentation/spec.md","spec_kind":"project","byte_length":8192,"edge_cases_count":null,"open_questions_count":5,"dod_items_count":8}
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

#### Arktype

```typescript
export const SpecAmendedEvent = type({
  ...envelopeFields,
  event_type: '"spec-amended"',
  spec_path: 'string',
  spec_kind: '"project" | "slice"',
  byte_length: 'number.integer>=0',
  bytes_delta: 'number.integer',
  edge_cases_count: 'number.integer>=0 | null',
  open_questions_count: 'number.integer>=0',
  dod_items_count: 'number.integer>=0',
  reason:
    '"falsified-assumption" | "new-edge-case" | "scope-shift" | "operator-correction" | "replan-from-discussion"',
  sections_changed: type('string').array(),
});
```

#### JSONL example

```jsonl
{"event_id":"p1000002-0001-4001-8001-000000000002","event_type":"spec-amended","schema_version":"1","ts":"2026-05-28T11:00:00.000Z","project_run_id":"drive-instrumentation","orchestrator_agent_id":null,"spec_path":"projects/drive-instrumentation/spec.md","spec_kind":"project","byte_length":9216,"bytes_delta":1024,"edge_cases_count":null,"open_questions_count":4,"dod_items_count":8,"reason":"falsified-assumption","sections_changed":["Approach","Edge cases"]}
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

#### Arktype

```typescript
const dispatchSizeDistribution = type({
  S: 'number.integer>=0',
  M: 'number.integer>=0',
  L: 'number.integer>=0',
  XL: 'number.integer>=0',
});

export const PlanAuthoredEvent = type({
  ...envelopeFields,
  event_type: '"plan-authored"',
  plan_path: 'string',
  plan_kind: '"project" | "slice"',
  byte_length: 'number.integer>=0',
  dispatch_count: 'number.integer>=0 | null',
  slice_count: 'number.integer>=0 | null',
  dispatch_size_distribution: dispatchSizeDistribution.or('null'),
  open_items_count: 'number.integer>=0',
});
```

#### JSONL example

```jsonl
{"event_id":"p2000001-0002-4002-8002-000000000001","event_type":"plan-authored","schema_version":"1","ts":"2026-05-28T10:30:00.000Z","project_run_id":"drive-instrumentation","orchestrator_agent_id":null,"plan_path":"projects/drive-instrumentation/slices/01-trace-vocab-and-build-instrumentation/plan.md","plan_kind":"slice","byte_length":4096,"dispatch_count":6,"slice_count":null,"dispatch_size_distribution":{"S":0,"M":6,"L":0,"XL":0},"open_items_count":2}
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

#### Arktype

```typescript
export const PlanAmendedEvent = type({
  ...envelopeFields,
  event_type: '"plan-amended"',
  plan_path: 'string',
  plan_kind: '"project" | "slice"',
  byte_length: 'number.integer>=0',
  bytes_delta: 'number.integer',
  dispatch_count: 'number.integer>=0 | null',
  slice_count: 'number.integer>=0 | null',
  dispatch_size_distribution: dispatchSizeDistribution.or('null'),
  open_items_count: 'number.integer>=0',
  reason:
    '"falsified-assumption" | "new-edge-case" | "scope-shift" | "operator-correction" | "replan-from-discussion" | "dispatch-resize" | "dispatch-added" | "dispatch-removed"',
  dispatches_added: 'number.integer>=0 | null',
  dispatches_removed: 'number.integer>=0 | null',
  dispatches_resized: 'number.integer>=0 | null',
});
```

#### JSONL example

```jsonl
{"event_id":"p2000002-0002-4002-8002-000000000002","event_type":"plan-amended","schema_version":"1","ts":"2026-05-28T12:00:00.000Z","project_run_id":"drive-instrumentation","orchestrator_agent_id":null,"plan_path":"projects/drive-instrumentation/slices/01-trace-vocab-and-build-instrumentation/plan.md","plan_kind":"slice","byte_length":5120,"bytes_delta":1024,"dispatch_count":7,"slice_count":null,"dispatch_size_distribution":{"S":0,"M":7,"L":0,"XL":0},"open_items_count":1,"reason":"dispatch-added","dispatches_added":1,"dispatches_removed":0,"dispatches_resized":0}
```

### `triage-verdict`

**Trigger.** `drive-triage-work` returns a verdict to its caller (fresh entry or mid-flight re-triage).

**Emitting skills.** `drive-triage-work`.

| Field | Type | Meaning |
|---|---|---|
| `verdict` | enum | `"direct-change"` \| `"orphan-slice"` \| `"in-project-slice"` \| `"new-project"` \| `"promote"` \| `"demote"` \| `"spike-first"` \| `"defer"`. |
| `input_shape` | enum | `"linear-ticket"` \| `"chat-ask"` \| `"customer-ask"` \| `"bug-report"` \| `"mid-flight-scope-signal"` \| `"i-should-do-x-thought"`. |
| `input_ref` | string \| null | Linear ticket ID when available (e.g. `TML-2704`); else `null`. |

#### Arktype

```typescript
export const TriageVerdictEvent = type({
  ...envelopeFields,
  event_type: '"triage-verdict"',
  verdict:
    '"direct-change" | "orphan-slice" | "in-project-slice" | "new-project" | "promote" | "demote" | "spike-first" | "defer"',
  input_shape:
    '"linear-ticket" | "chat-ask" | "customer-ask" | "bug-report" | "mid-flight-scope-signal" | "i-should-do-x-thought"',
  input_ref: 'string | null',
});
```

#### JSONL example

```jsonl
{"event_id":"p3000001-0003-4003-8003-000000000001","event_type":"triage-verdict","schema_version":"1","ts":"2026-05-28T09:00:00.000Z","project_run_id":"drive-instrumentation","orchestrator_agent_id":null,"verdict":"in-project-slice","input_shape":"linear-ticket","input_ref":"TML-2704"}
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

#### Arktype

```typescript
export const FalsifiedAssumptionEvent = type({
  ...envelopeFields,
  event_type: '"falsified-assumption"',
  artifact_path: 'string',
  triggered_by:
    '"implementer-pushback" | "wip-inspection" | "dispatch-blocked" | "health-check-drift" | "orchestrator-self-detected" | "operator-flagged"',
  assumption_summary: 'string | null',
});
```

#### JSONL example

```jsonl
{"event_id":"p4000001-0004-4004-8004-000000000001","event_type":"falsified-assumption","schema_version":"1","ts":"2026-05-28T11:30:00.000Z","project_run_id":"drive-instrumentation","orchestrator_agent_id":null,"artifact_path":"projects/drive-instrumentation/spec.md","triggered_by":"implementer-pushback","assumption_summary":"Canonical skill path was .agents/skills/ not skills-contrib/"}
```

#### Notes

The event fires even when the downstream spec/plan amendment is deferred to the operator; spec-amendment-rate metrics must not assume 1:1 pairing with `falsified-assumption` counts.

## Arktype schemas

Reference definitions for slice-3 read-time validation. Instrumented skills construct conformant payloads from orchestrator state at emit time; slice 1 does not validate on write.

Conventions match the codebase: `import { type } from 'arktype'`, object schemas via `type({ ... })`, optional keys with `'field?'`, nullable unions with `'string | null'`, string-literal unions inline.

```typescript
import { type } from 'arktype';

/** UUID v4 string — emit-side assigns a fresh v4; read validator may tighten. */
const uuidV4 = 'string';

const envelopeFields = {
  event_id: uuidV4,
  schema_version: '"1"' as const,
  ts: 'string', // ISO 8601 UTC
  project_run_id: 'string',
  orchestrator_agent_id: 'string | null',
};

export const DispatchStartEvent = type({
  ...envelopeFields,
  event_type: '"dispatch-start"',
  dispatch_id: uuidV4,
  dispatch_name: 'string',
  subagent_type: 'string',
  model: 'string | null',
  parent_dispatch_id: 'string | null',
});

export const DispatchEndEvent = type({
  ...envelopeFields,
  event_type: '"dispatch-end"',
  dispatch_id: uuidV4,
  result: '"completed" | "failed" | "aborted"',
  wall_clock_ms: 'number.integer>=0',
});

export const RoundStartEvent = type({
  ...envelopeFields,
  event_type: '"round-start"',
  dispatch_id: uuidV4,
  round_id: uuidV4,
  round_number: 'number.integer>=1',
});

export const RoundEndEvent = type({
  ...envelopeFields,
  event_type: '"round-end"',
  dispatch_id: uuidV4,
  round_id: uuidV4,
  verdict:
    '"satisfied" | "another-round-needed" | "escalating-to-user" | "stop-condition"',
  findings_filed: 'number.integer>=0',
  wall_clock_ms: 'number.integer>=0',
});

export const BriefIssuedEvent = type({
  ...envelopeFields,
  event_type: '"brief-issued"',
  dispatch_id: uuidV4,
  round_id: uuidV4,
  brief_byte_length: 'number.integer>=0',
  brief_content_hash: 'string',
  brief_disposition: '"initial" | "reissue" | "amended"',
});

const dispatchSizeDistribution = type({
  S: 'number.integer>=0',
  M: 'number.integer>=0',
  L: 'number.integer>=0',
  XL: 'number.integer>=0',
});

export const SpecAuthoredEvent = type({
  ...envelopeFields,
  event_type: '"spec-authored"',
  spec_path: 'string',
  spec_kind: '"project" | "slice"',
  byte_length: 'number.integer>=0',
  edge_cases_count: 'number.integer>=0 | null',
  open_questions_count: 'number.integer>=0',
  dod_items_count: 'number.integer>=0',
});

export const SpecAmendedEvent = type({
  ...envelopeFields,
  event_type: '"spec-amended"',
  spec_path: 'string',
  spec_kind: '"project" | "slice"',
  byte_length: 'number.integer>=0',
  bytes_delta: 'number.integer',
  edge_cases_count: 'number.integer>=0 | null',
  open_questions_count: 'number.integer>=0',
  dod_items_count: 'number.integer>=0',
  reason:
    '"falsified-assumption" | "new-edge-case" | "scope-shift" | "operator-correction" | "replan-from-discussion"',
  sections_changed: type('string').array(),
});

export const PlanAuthoredEvent = type({
  ...envelopeFields,
  event_type: '"plan-authored"',
  plan_path: 'string',
  plan_kind: '"project" | "slice"',
  byte_length: 'number.integer>=0',
  dispatch_count: 'number.integer>=0 | null',
  slice_count: 'number.integer>=0 | null',
  dispatch_size_distribution: dispatchSizeDistribution.or('null'),
  open_items_count: 'number.integer>=0',
});

export const PlanAmendedEvent = type({
  ...envelopeFields,
  event_type: '"plan-amended"',
  plan_path: 'string',
  plan_kind: '"project" | "slice"',
  byte_length: 'number.integer>=0',
  bytes_delta: 'number.integer',
  dispatch_count: 'number.integer>=0 | null',
  slice_count: 'number.integer>=0 | null',
  dispatch_size_distribution: dispatchSizeDistribution.or('null'),
  open_items_count: 'number.integer>=0',
  reason:
    '"falsified-assumption" | "new-edge-case" | "scope-shift" | "operator-correction" | "replan-from-discussion" | "dispatch-resize" | "dispatch-added" | "dispatch-removed"',
  dispatches_added: 'number.integer>=0 | null',
  dispatches_removed: 'number.integer>=0 | null',
  dispatches_resized: 'number.integer>=0 | null',
});

export const TriageVerdictEvent = type({
  ...envelopeFields,
  event_type: '"triage-verdict"',
  verdict:
    '"direct-change" | "orphan-slice" | "in-project-slice" | "new-project" | "promote" | "demote" | "spike-first" | "defer"',
  input_shape:
    '"linear-ticket" | "chat-ask" | "customer-ask" | "bug-report" | "mid-flight-scope-signal" | "i-should-do-x-thought"',
  input_ref: 'string | null',
});

export const FalsifiedAssumptionEvent = type({
  ...envelopeFields,
  event_type: '"falsified-assumption"',
  artifact_path: 'string',
  triggered_by:
    '"implementer-pushback" | "wip-inspection" | "dispatch-blocked" | "health-check-drift" | "orchestrator-self-detected" | "operator-flagged"',
  assumption_summary: 'string | null',
});

export const Slice1TraceEvent = DispatchStartEvent.or(DispatchEndEvent)
  .or(RoundStartEvent)
  .or(RoundEndEvent)
  .or(BriefIssuedEvent)
  .or(SpecAuthoredEvent)
  .or(SpecAmendedEvent)
  .or(PlanAuthoredEvent)
  .or(PlanAmendedEvent)
  .or(TriageVerdictEvent)
  .or(FalsifiedAssumptionEvent);
```

Each exported `*Event` schema is the full flat object (envelope + payload). Slice-3 read validators should accept exactly these shapes.

## JSONL examples

One example line per slice-1 event type (build loop, then planning chain). Payload values are illustrative.

```jsonl
{"event_id":"a1b2c3d4-e5f6-4789-a012-3456789abcde","event_type":"dispatch-start","schema_version":"1","ts":"2026-05-28T14:00:00.000Z","project_run_id":"drive-instrumentation","orchestrator_agent_id":null,"dispatch_id":"b2c3d4e5-f6a7-4890-b123-456789abcdef","dispatch_name":"implementer D1 R1","subagent_type":"generalPurpose","model":"composer-2.5-fast","parent_dispatch_id":null}
{"event_id":"c3d4e5f6-a7b8-4901-c234-56789abcdef0","event_type":"round-start","schema_version":"1","ts":"2026-05-28T14:00:01.000Z","project_run_id":"drive-instrumentation","orchestrator_agent_id":null,"dispatch_id":"b2c3d4e5-f6a7-4890-b123-456789abcdef","round_id":"d4e5f6a7-b8c9-4012-d345-6789abcdef01","round_number":1}
{"event_id":"e5f6a7b8-c9d0-4123-e456-789abcdef012","event_type":"brief-issued","schema_version":"1","ts":"2026-05-28T14:00:02.000Z","project_run_id":"drive-instrumentation","orchestrator_agent_id":null,"dispatch_id":"b2c3d4e5-f6a7-4890-b123-456789abcdef","round_id":"d4e5f6a7-b8c9-4012-d345-6789abcdef01","brief_byte_length":4096,"brief_content_hash":"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08","brief_disposition":"initial"}
{"event_id":"f6a7b8c9-d0e1-4234-f567-89abcdef0123","event_type":"round-end","schema_version":"1","ts":"2026-05-28T15:30:00.000Z","project_run_id":"drive-instrumentation","orchestrator_agent_id":null,"dispatch_id":"b2c3d4e5-f6a7-4890-b123-456789abcdef","round_id":"d4e5f6a7-b8c9-4012-d345-6789abcdef01","verdict":"satisfied","findings_filed":0,"wall_clock_ms":5399000}
{"event_id":"a7b8c9d0-e1f2-4345-a678-9abcdef01234","event_type":"dispatch-end","schema_version":"1","ts":"2026-05-28T15:30:01.000Z","project_run_id":"drive-instrumentation","orchestrator_agent_id":null,"dispatch_id":"b2c3d4e5-f6a7-4890-b123-456789abcdef","result":"completed","wall_clock_ms":5401000}
{"event_id":"p1000001-0001-4001-8001-000000000001","event_type":"spec-authored","schema_version":"1","ts":"2026-05-28T10:00:00.000Z","project_run_id":"drive-instrumentation","orchestrator_agent_id":null,"spec_path":"projects/drive-instrumentation/spec.md","spec_kind":"project","byte_length":8192,"edge_cases_count":null,"open_questions_count":5,"dod_items_count":8}
{"event_id":"p1000002-0001-4001-8001-000000000002","event_type":"spec-amended","schema_version":"1","ts":"2026-05-28T11:00:00.000Z","project_run_id":"drive-instrumentation","orchestrator_agent_id":null,"spec_path":"projects/drive-instrumentation/spec.md","spec_kind":"project","byte_length":9216,"bytes_delta":1024,"edge_cases_count":null,"open_questions_count":4,"dod_items_count":8,"reason":"falsified-assumption","sections_changed":["Approach","Edge cases"]}
{"event_id":"p2000001-0002-4002-8002-000000000001","event_type":"plan-authored","schema_version":"1","ts":"2026-05-28T10:30:00.000Z","project_run_id":"drive-instrumentation","orchestrator_agent_id":null,"plan_path":"projects/drive-instrumentation/plan.md","plan_kind":"project","byte_length":6144,"dispatch_count":null,"slice_count":3,"dispatch_size_distribution":null,"open_items_count":1}
{"event_id":"p2000002-0002-4002-8002-000000000002","event_type":"plan-amended","schema_version":"1","ts":"2026-05-28T12:00:00.000Z","project_run_id":"drive-instrumentation","orchestrator_agent_id":null,"plan_path":"projects/drive-instrumentation/slices/01-trace-vocab-and-build-instrumentation/plan.md","plan_kind":"slice","byte_length":5120,"bytes_delta":1024,"dispatch_count":7,"slice_count":null,"dispatch_size_distribution":{"S":0,"M":7,"L":0,"XL":0},"open_items_count":1,"reason":"dispatch-added","dispatches_added":1,"dispatches_removed":0,"dispatches_resized":0}
{"event_id":"p3000001-0003-4003-8003-000000000001","event_type":"triage-verdict","schema_version":"1","ts":"2026-05-28T09:00:00.000Z","project_run_id":"drive-instrumentation","orchestrator_agent_id":null,"verdict":"in-project-slice","input_shape":"linear-ticket","input_ref":"TML-2704"}
{"event_id":"p4000001-0004-4004-8004-000000000001","event_type":"falsified-assumption","schema_version":"1","ts":"2026-05-28T11:30:00.000Z","project_run_id":"drive-instrumentation","orchestrator_agent_id":null,"artifact_path":"projects/drive-instrumentation/spec.md","triggered_by":"implementer-pushback","assumption_summary":"Canonical skill path was .agents/skills/ not skills-contrib/"}
```

## References

- Emission protocol (path resolution, append mechanics): [`trace-emission.md`](./trace-emission.md).
- Parent instrumentation project: transient artefact under `projects/drive-instrumentation/` (methodology surfaces migrate to `docs/` on project close-out).
- Brief shape the `brief-issued` event measures: [`principles/brief-discipline.md`](./principles/brief-discipline.md).
- Instrumented skill (slice 1): [`skills-contrib/drive-build-workflow/SKILL.md`](../../skills-contrib/drive-build-workflow/SKILL.md).
