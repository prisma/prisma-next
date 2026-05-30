# Drive trace emission protocol

## At a glance

Shared protocol for appending Drive trace events to JSONL files. Instrumented `drive-*` skill bodies cite this doc for file-path resolution and append mechanics; event field definitions live in [`events.md`](./events.md).

The orchestrator is the sole writer per trace file (sub-agents do not emit). Slice 1 does not add file locks; the orchestrator's sequential tool calls already serialise writes.

**ADR note:** The trace-emission protocol is an architectural shift for Drive observability. An ADR is planned at project close-out; if the operator or reviewer wants it earlier, slice 3 carries it.

## Trace file path resolution

Resolve the trace file path once per orchestrator session from current project context:

| Context | Trace file path | `project_run_id` (envelope) |
|---|---|---|
| In-project slice or project work | `projects/<project-slug>/trace.jsonl` | `<project-slug>` (e.g. `sample-project`) |
| Orphan slice (no parent project) | `wip/drive-trace/orphan-<slice-slug>.jsonl` | `orphan-<slice-slug>` |
| Direct change | `wip/drive-trace/direct-<ISO-timestamp>.jsonl` | `direct-<ISO-timestamp>` |

`<ISO-timestamp>` uses the same ISO 8601 UTC form as envelope `ts` (e.g. `2026-05-28T14:00:00.000Z`), including colons in the filename.

`wip/drive-trace/` is gitignored via the repo's `/wip` rule — orphan and direct-change traces do not leak project scope into version control.

## First emit (file and directory creation)

If the trace file or its parent directory does not exist, the emitter (§ Append protocol) creates both on the first write — it runs `mkdir -p` on the parent directory before appending. No separate initialization step is required.

Partial traces are acceptable: a `dispatch-start` without a matching `dispatch-end` is a recognised diagnostic signal for later assertion tooling. There are no transactional guarantees across events.

## Append-only JSONL conventions

- **One event per line.** Each line is exactly one JSON object; no pretty-printing across lines.
- **Append only.** Never rewrite or truncate the file mid-run; readers assume monotonic append.
- **Flat objects.** No nested arrays at the top level; envelope and payload fields merge into one object (see [`events.md`](./events.md)).
- **UTF-8 strict.** Serialize with UTF-8 encoding; `brief_byte_length` and hashes assume UTF-8 byte counts of the brief text.
- **Compact JSON.** Prefer `JSON.stringify` without extra whitespace so line length stays predictable.
- **No extra fields.** Slice 1 emits exactly the documented vocabulary; forward-compat via undeclared fields is out of scope.

## Schema validation

Validation happens **at emit time**. The emitter (§ Append protocol) validates the fully-merged event against the canonical arktype schema in [`schema.ts`](./schema.ts) *before* writing, and refuses to append a non-conformant event (fail-closed: it exits non-zero and writes nothing). This is the first gate — a malformed line never reaches the file.

Read-time validation in `drive-diagnose-run` runs against the same schema and remains a second gate for traces from other sources or older runs.

## Append protocol

The canonical emit mechanic is the **deterministic emitter CLI** this skill ships, [`emit.ts`](./emit.ts). The orchestrator computes the event's payload fields and invokes the emitter; the emitter owns the envelope (`event_id`, `schema_version`, `ts`), merges payload and envelope, validates the merged event against [`schema.ts`](./schema.ts), and appends exactly one compact JSON line **only if validation passes**. It creates the trace file's parent directory on first write. Because the envelope is generated and the event is validated before the append, malformed lines never reach the file — the agent no longer hand-builds the envelope or hand-appends the line.

### Invocation

```bash
node skills-contrib/drive-record-traces/emit.ts \
  --trace-file <path> \
  --project-run-id <id> \
  --event <event-type> \
  --payload '<json-object-of-payload-only-fields>' \
  [--orchestrator-agent-id <id>]
```

In this repo, `pnpm drive:emit` is the equivalent shortcut.

Concrete example for in-project work:

```bash
node skills-contrib/drive-record-traces/emit.ts \
  --trace-file projects/sample-project/trace.jsonl \
  --project-run-id sample-project \
  --event triage-verdict \
  --payload '{"verdict":"in-project-slice","input_shape":"linear-ticket","input_ref":"TML-2704"}'
```

**Payload is payload-only.** `--payload` carries the per-event fields documented in [`events.md`](./events.md) — including any fresh UUIDs the event itself needs (e.g. `dispatch_id`, `round_id`), which are payload fields the orchestrator generates. It must **not** carry envelope keys (`event_id`, `event_type`, `schema_version`, `ts`, `project_run_id`, `orchestrator_agent_id`); the emitter owns those and rejects any payload that includes one, naming the offending key.

**Shell hygiene:** single-quote the `--payload` JSON so the shell does not interpret `$`, backticks, or quotes inside it.

### Concurrency

Slice 1 assumes a single orchestrator writer per trace file (`drive-build-workflow` is sequential per role). Parallel role dispatches that write the same file are out of scope for slice-1 verification; `dispatch_id` uniqueness still allows correct grouping if parallel dispatch becomes a real shape later.

## Canonical Emit snippet (for skill bodies)

Instrumented skills grow by ~one line per transition point. Each emit step names the event type, lists payload fields the orchestrator must compute, refers to this skill **by name** (no path — the runtime resolves `drive-record-traces`), and delegates the emit mechanic here:

> **Emit `{event_type}`:** Compute this event's payload fields (see the `drive-record-traces` skill — `events.md` § `{event_type}`), then invoke that skill's emitter per its `emission.md` § Append protocol: `--event {event_type} --payload '<payload-only fields>'`, supplying `--trace-file` and `--project-run-id` from the resolved session context. The emitter owns the envelope (`event_id`, `schema_version`, `ts`) and validates before appending — pass payload-only fields, not envelope keys.

Replace `{event_type}` with the event name for the transition point. Build loop: `dispatch-start`, `dispatch-end`, `round-start`, `round-end`, `brief-issued`. Planning chain: `spec-authored`, `spec-amended`, `plan-authored`, `plan-amended`, `triage-verdict`, `falsified-assumption`. For spec/plan writes, apply § Existence-check pattern before choosing `*-authored` vs `*-amended`. Resolve `TRACE_FILE` from § Trace file path resolution before the first emit in the session.

## Existence-check pattern for `*-authored` vs `*-amended` events

Four planning-chain write events — [`spec-authored`](./events.md#spec-authored), [`spec-amended`](./events.md#spec-amended), [`plan-authored`](./events.md#plan-authored), [`plan-amended`](./events.md#plan-amended) — share a gating decision at emit time: did the target artefact file already exist on disk immediately before this write?

The emitting skill (`drive-specify-project`, `drive-specify-slice`, `drive-plan-project`, `drive-plan-slice`) checks file existence **before** committing the write, then emits exactly one event:

- Target path **absent** → emit `*-authored` with the first-write payload fields.
- Target path **present** → emit `*-amended` with amendment fields (`bytes_delta`, `reason`, and type-specific deltas).

This is not a separate trace event — it selects which of two documented event types to append using the same § Append protocol mechanics.

**Shell sketch** (adapt paths and payload construction to the skill's write step):

```bash
SPEC_PATH="projects/sample-project/spec.md"
if [ -f "$SPEC_PATH" ]; then
  EVENT_TYPE="spec-amended"
else
  EVENT_TYPE="spec-authored"
fi
# Compute PAYLOAD_JSON for $EVENT_TYPE per ./events.md (payload-only fields), then:
node skills-contrib/drive-record-traces/emit.ts \
  --trace-file "$TRACE_FILE" --project-run-id "$PROJECT_RUN_ID" \
  --event "$EVENT_TYPE" --payload "$PAYLOAD_JSON"
```

Equivalent one-liner gate: `[ -f "<path>" ] && emit "*-amended" || emit "*-authored"`.

The check uses the orchestrator's filesystem view at write time. A same-session re-author of a spec just written sees the file present and correctly emits `spec-amended` on the second write.

## Operator checklist (emit time)

1. Resolve `TRACE_FILE` from project context (in-project / orphan / direct-change).
2. Resolve `project_run_id` to match the resolved context row in the path table.
3. Compute the payload fields for the event type (see [`events.md`](./events.md)), including any fresh UUIDs the event itself needs (`dispatch_id`, `round_id`) — these are payload fields. For spec/plan writes, apply § Existence-check pattern to choose the `--event` value.
4. Run the emitter (§ Append protocol) with `--trace-file`, `--project-run-id`, `--event`, and `--payload`; pass `--orchestrator-agent-id` when the session UUID is knowable (else omit — it defaults to `null`). The emitter assigns `event_id`, sets `schema_version` and `ts`, validates the merged event, and appends.

## Direct-change build-loop spine reuse

A **direct change** (triage verdict `"direct-change"`, routed through `drive-start-workflow` Step 5) emits no new event types. Instead, it reuses the five build-loop events — [`dispatch-start`](./events.md#dispatch-start), [`round-start`](./events.md#round-start), [`brief-issued`](./events.md#brief-issued), [`round-end`](./events.md#round-end), [`dispatch-end`](./events.md#dispatch-end) — from the direct-change sub-path in `drive-start-workflow`, modelling the work as a single-dispatch, single-round unit:

| Field | Direct-change value |
|---|---|
| `dispatch_name` | `"direct-change <ticket>"` (ticket slug or short descriptor when no Linear ticket) |
| `parent_dispatch_id` | `null` (direct changes have no parent dispatch) |
| `round_number` | `1` (one-shot; direct changes do not loop by default) |
| `brief_disposition` | `"initial"` (first and only brief for this dispatch) |
| `project_run_id` | `"direct-<ISO-ts>"` (resolved from the direct-change row in § Trace file path resolution) |
| `TRACE_FILE` | `wip/drive-trace/direct-<ISO-ts>.jsonl` |

The emit-sites live in `drive-start-workflow` (Step 5 direct-change sub-path: three events before the `drive-dispatch` call, two after). `drive-dispatch` itself carries **no** emit-sites.

## References

- Event vocabulary (envelope, payloads, arktype, examples): [`events.md`](./events.md).
- Drive domain model (dispatch, round, ProjectRun): the Drive `model` doc.
- Brief discipline (feeds `brief-issued`): the Drive `brief-discipline` principle doc.
