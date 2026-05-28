# Drive trace emission protocol

## At a glance

Shared protocol for appending Drive trace events to JSONL files. Instrumented `drive-*` skill bodies cite this doc for file-path resolution and append mechanics; event field definitions live in [`trace-events.md`](./trace-events.md).

The orchestrator is the sole writer per trace file (sub-agents do not emit). Slice 1 does not add file locks; the orchestrator's sequential tool calls already serialise writes.

**ADR note:** The trace-emission protocol is an architectural shift for Drive observability. An ADR is planned at project close-out; if the operator or reviewer wants it earlier, slice 3 carries it.

## Trace file path resolution

Resolve the trace file path once per orchestrator session from current project context:

| Context | Trace file path | `project_run_id` (envelope) |
|---|---|---|
| In-project slice or project work | `projects/<project-slug>/trace.jsonl` | `<project-slug>` (e.g. `drive-instrumentation`) |
| Orphan slice (no parent project) | `wip/drive-trace/orphan-<slice-slug>.jsonl` | `orphan-<slice-slug>` |
| Direct change | `wip/drive-trace/direct-<ISO-timestamp>.jsonl` | `direct-<ISO-timestamp>` |

`<ISO-timestamp>` uses the same ISO 8601 UTC form as envelope `ts` (e.g. `2026-05-28T14:00:00.000Z`), including colons in the filename.

`wip/drive-trace/` is gitignored via the repo's `/wip` rule — orphan and direct-change traces do not leak project scope into version control.

## First emit (file and directory creation)

If the trace file or its parent directory does not exist, the first append creates both (`mkdir -p` semantics on the parent directory, then create-or-append on the file). No separate initialization step is required.

Partial traces are acceptable: a `dispatch-start` without a matching `dispatch-end` is a recognised diagnostic signal for later assertion tooling. There are no transactional guarantees across events.

## Append-only JSONL conventions

- **One event per line.** Each line is exactly one JSON object; no pretty-printing across lines.
- **Append only.** Never rewrite or truncate the file mid-run; readers assume monotonic append.
- **Flat objects.** No nested arrays at the top level; envelope and payload fields merge into one object (see [`trace-events.md`](./trace-events.md)).
- **UTF-8 strict.** Serialize with UTF-8 encoding; `brief_byte_length` and hashes assume UTF-8 byte counts of the brief text.
- **Compact JSON.** Prefer `JSON.stringify` without extra whitespace so line length stays predictable.
- **No extra fields.** Slice 1 emits exactly the documented vocabulary; forward-compat via undeclared fields is out of scope.

## Schema validation

Slice 1 does not validate payloads at emit time. The orchestrator constructs events from known state; conformant shape is the implementer's responsibility against [`trace-events.md`](./trace-events.md). Read-time validation against the documented arktype schemas is a slice-3 deliverable.

## Append protocol

### File-write tool

**Use the `Shell` tool with `>>` append.**

| Option | Verdict |
|---|---|
| `Shell` + `>>` | **Chosen.** One syscall appends a line without read-modify-write races; creates the file if missing when combined with `mkdir -p` on the parent directory. |
| Read-then-Write | Rejected for emit hot path. Reads the entire trace file on every event; scales poorly and invites lost updates if concurrency ever appears. |
| StrReplace append | Rejected. Requires reading the file to find an anchor; fragile on empty files and not designed for append-only JSONL. |

### Command pattern

After constructing the event object and serialising it to a single-line JSON string (variable `EVENT_JSON` in the sketch below):

```bash
mkdir -p "$(dirname "$TRACE_FILE")" && printf '%s\n' "$EVENT_JSON" >> "$TRACE_FILE"
```

Concrete example for in-project work:

```bash
TRACE_FILE="projects/drive-instrumentation/trace.jsonl"
EVENT_JSON='{"event_id":"…","event_type":"dispatch-start",…}'
mkdir -p "$(dirname "$TRACE_FILE")" && printf '%s\n' "$EVENT_JSON" >> "$TRACE_FILE"
```

**Shell hygiene:** Ensure `EVENT_JSON` is single-quoted or safely escaped so the shell does not interpret `$`, backticks, or quotes inside the JSON. Prefer generating JSON in the orchestrator's structured context, then passing it as one quoted argument to `printf`.

**Why `printf` not `echo`:** `printf '%s\n'` emits exactly one trailing newline without implementation-defined `echo` flags.

### Concurrency

Slice 1 assumes a single orchestrator writer per trace file (`drive-build-workflow` is sequential per role). Parallel role dispatches that write the same file are out of scope for slice-1 verification; `dispatch_id` uniqueness still allows correct grouping if parallel dispatch becomes a real shape later.

## Canonical Emit snippet (for skill bodies)

Instrumented skills grow by ~one line per transition point. Each emit step names the event type, lists payload fields the orchestrator must compute (see [`trace-events.md`](./trace-events.md)), and delegates append mechanics here:

> **Emit `{event_type}`:** Build the envelope (`event_id`, `schema_version: "1"`, `ts`, `project_run_id`, `orchestrator_agent_id`) plus this event's payload fields (see [`trace-events.md`](./trace-events.md) § `{event_type}`). Append one JSON line per [`trace-emission.md`](./trace-emission.md) § Append protocol (`Shell` + `mkdir -p` + `printf … >> trace file`).

Replace `{event_type}` with `dispatch-start`, `dispatch-end`, `round-start`, `round-end`, or `brief-issued`. Resolve `TRACE_FILE` from § Trace file path resolution before the first emit in the session.

## Operator checklist (emit time)

1. Resolve `TRACE_FILE` from project context (in-project / orphan / direct-change).
2. Assign fresh UUIDs for `event_id` and any new `dispatch_id` / `round_id`.
3. Set `schema_version` to `"1"`.
4. Set `ts` to current UTC ISO 8601.
5. Set `project_run_id` to match the resolved context row in the path table.
6. Set `orchestrator_agent_id` to the session UUID when knowable, else `null`.
7. Merge payload fields for the event type.
8. Run the § Append protocol command.

## References

- Event vocabulary (envelope, payloads, arktype, examples): [`trace-events.md`](./trace-events.md).
- Drive domain model (dispatch, round, ProjectRun): [`model.md`](./model.md).
- Brief discipline (feeds `brief-issued`): [`principles/brief-discipline.md`](./principles/brief-discipline.md).
