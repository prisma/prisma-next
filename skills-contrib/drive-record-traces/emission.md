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

If the trace file or its parent directory does not exist, the first append creates both (`mkdir -p` semantics on the parent directory, then create-or-append on the file). No separate initialization step is required.

Partial traces are acceptable: a `dispatch-start` without a matching `dispatch-end` is a recognised diagnostic signal for later assertion tooling. There are no transactional guarantees across events.

## Append-only JSONL conventions

- **One event per line.** Each line is exactly one JSON object; no pretty-printing across lines.
- **Append only.** Never rewrite or truncate the file mid-run; readers assume monotonic append.
- **Flat objects.** No nested arrays at the top level; envelope and payload fields merge into one object (see [`events.md`](./events.md)).
- **UTF-8 strict.** Serialize with UTF-8 encoding; `brief_byte_length` and hashes assume UTF-8 byte counts of the brief text.
- **Compact JSON.** Prefer `JSON.stringify` without extra whitespace so line length stays predictable.
- **No extra fields.** Slice 1 emits exactly the documented vocabulary; forward-compat via undeclared fields is out of scope.

## Schema validation

Slice 1 does not validate payloads at emit time. The orchestrator constructs events from known state; conformant shape is the implementer's responsibility against [`events.md`](./events.md). Read-time validation against the documented arktype schemas is a slice-3 deliverable.

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
TRACE_FILE="projects/sample-project/trace.jsonl"
EVENT_JSON='{"event_id":"…","event_type":"dispatch-start",…}'
mkdir -p "$(dirname "$TRACE_FILE")" && printf '%s\n' "$EVENT_JSON" >> "$TRACE_FILE"
```

**Shell hygiene:** Ensure `EVENT_JSON` is single-quoted or safely escaped so the shell does not interpret `$`, backticks, or quotes inside the JSON. Prefer generating JSON in the orchestrator's structured context, then passing it as one quoted argument to `printf`.

**Why `printf` not `echo`:** `printf '%s\n'` emits exactly one trailing newline without implementation-defined `echo` flags.

### Concurrency

Slice 1 assumes a single orchestrator writer per trace file (`drive-build-workflow` is sequential per role). Parallel role dispatches that write the same file are out of scope for slice-1 verification; `dispatch_id` uniqueness still allows correct grouping if parallel dispatch becomes a real shape later.

## Canonical Emit snippet (for skill bodies)

Instrumented skills grow by ~one line per transition point. Each emit step names the event type, lists payload fields the orchestrator must compute, refers to this skill **by name** (no path — the runtime resolves `drive-record-traces`), and delegates append mechanics here:

> **Emit `{event_type}`:** Build the envelope (`event_id`, `schema_version: "1"`, `ts`, `project_run_id`, `orchestrator_agent_id`) plus this event's payload fields (see the `drive-record-traces` skill — `events.md` § `{event_type}`). Append one JSON line per the same skill's `emission.md` § Append protocol (`Shell` + `mkdir -p` + `printf … >> trace file`).

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
# Build EVENT_JSON for $EVENT_TYPE per ./events.md, then:
mkdir -p "$(dirname "$TRACE_FILE")" && printf '%s\n' "$EVENT_JSON" >> "$TRACE_FILE"
```

Equivalent one-liner gate: `[ -f "<path>" ] && emit "*-amended" || emit "*-authored"`.

The check uses the orchestrator's filesystem view at write time. A same-session re-author of a spec just written sees the file present and correctly emits `spec-amended` on the second write.

## Operator checklist (emit time)

1. Resolve `TRACE_FILE` from project context (in-project / orphan / direct-change).
2. Assign fresh UUIDs for `event_id` and any new `dispatch_id` / `round_id`.
3. Set `schema_version` to `"1"`.
4. Set `ts` to current UTC ISO 8601.
5. Set `project_run_id` to match the resolved context row in the path table.
6. Set `orchestrator_agent_id` to the session UUID when knowable, else `null`.
7. Merge payload fields for the event type.
8. Run the § Append protocol command.

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
