# Drive trace event vocabulary

## At a glance

Versioned event vocabulary for Drive orchestrator instrumentation. Every instrumented skill emits structured events to a project-scoped `trace.jsonl` file (see [`trace-emission.md`](./trace-emission.md) for path resolution and append protocol). Slice 1 ships five event types on the dispatch/round spine; later slices extend the vocabulary without breaking readers that honour `schema_version`.

**Vocabulary version:** `schema_version: "1"`.

**Consumers:** instrumented `drive-*` skill bodies (emit-side construction), slice-3 read-time validators, manual QA, and future metric harnesses.

## File shape

Each event is one JSON object on its own line in `trace.jsonl`. Events share a common envelope; each event type adds payload fields at the top level of the same object (flat merge — no nested `payload` wrapper). Order in the file is canonical; `ts` is not guaranteed monotonic across re-entrant skills.

## Common envelope

Every event carries these fields:

| Field | Type | Meaning |
|---|---|---|
| `event_id` | UUID v4 | Unique per event; assigned at emit time. |
| `event_type` | string | One of the documented event-type names (slice 1: `dispatch-start`, `dispatch-end`, `round-start`, `round-end`, `brief-issued`). |
| `schema_version` | string | Vocabulary version. Slice 1 ships `"1"`. |
| `ts` | ISO 8601 UTC string | Wall-clock at emit time. |
| `project_run_id` | string | Stable identifier for the ProjectRun this event belongs to. Format: project slug for in-project work (e.g. `drive-instrumentation`); `orphan-<slice-slug>` for orphan slices; `direct-<ISO-ts>` for direct changes. Slice 1 hard-codes this per emission site from orchestrator context; automated detection is a later-slice concern. |
| `orchestrator_agent_id` | string \| null | Cursor session UUID when knowable from environment / SDK. Slice 1 emits `null` when not reachable from inside the skill body. |

## Event types (slice 1)

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

export const Slice1TraceEvent = DispatchStartEvent.or(DispatchEndEvent)
  .or(RoundStartEvent)
  .or(RoundEndEvent)
  .or(BriefIssuedEvent);
```

Each exported `*Event` schema is the full flat object (envelope + payload). Slice-3 read validators should accept exactly these shapes.

## JSONL examples

One example line per slice-1 event type. Payload values are illustrative.

```jsonl
{"event_id":"a1b2c3d4-e5f6-4789-a012-3456789abcde","event_type":"dispatch-start","schema_version":"1","ts":"2026-05-28T14:00:00.000Z","project_run_id":"drive-instrumentation","orchestrator_agent_id":null,"dispatch_id":"b2c3d4e5-f6a7-4890-b123-456789abcdef","dispatch_name":"implementer D1 R1","subagent_type":"generalPurpose","model":"composer-2.5-fast","parent_dispatch_id":null}
{"event_id":"c3d4e5f6-a7b8-4901-c234-56789abcdef0","event_type":"round-start","schema_version":"1","ts":"2026-05-28T14:00:01.000Z","project_run_id":"drive-instrumentation","orchestrator_agent_id":null,"dispatch_id":"b2c3d4e5-f6a7-4890-b123-456789abcdef","round_id":"d4e5f6a7-b8c9-4012-d345-6789abcdef01","round_number":1}
{"event_id":"e5f6a7b8-c9d0-4123-e456-789abcdef012","event_type":"brief-issued","schema_version":"1","ts":"2026-05-28T14:00:02.000Z","project_run_id":"drive-instrumentation","orchestrator_agent_id":null,"dispatch_id":"b2c3d4e5-f6a7-4890-b123-456789abcdef","round_id":"d4e5f6a7-b8c9-4012-d345-6789abcdef01","brief_byte_length":4096,"brief_content_hash":"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08","brief_disposition":"initial"}
{"event_id":"f6a7b8c9-d0e1-4234-f567-89abcdef0123","event_type":"round-end","schema_version":"1","ts":"2026-05-28T15:30:00.000Z","project_run_id":"drive-instrumentation","orchestrator_agent_id":null,"dispatch_id":"b2c3d4e5-f6a7-4890-b123-456789abcdef","round_id":"d4e5f6a7-b8c9-4012-d345-6789abcdef01","verdict":"satisfied","findings_filed":0,"wall_clock_ms":5399000}
{"event_id":"a7b8c9d0-e1f2-4345-a678-9abcdef01234","event_type":"dispatch-end","schema_version":"1","ts":"2026-05-28T15:30:01.000Z","project_run_id":"drive-instrumentation","orchestrator_agent_id":null,"dispatch_id":"b2c3d4e5-f6a7-4890-b123-456789abcdef","result":"completed","wall_clock_ms":5401000}
```

## References

- Emission protocol (path resolution, append mechanics): [`trace-emission.md`](./trace-emission.md).
- Parent instrumentation project: transient artefact under `projects/drive-instrumentation/` (methodology surfaces migrate to `docs/` on project close-out).
- Brief shape the `brief-issued` event measures: [`principles/brief-discipline.md`](./principles/brief-discipline.md).
- Instrumented skill (slice 1): [`skills-contrib/drive-build-workflow/SKILL.md`](../../skills-contrib/drive-build-workflow/SKILL.md).
