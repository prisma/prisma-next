---
name: drive-record-traces
description: >
  Library skill that owns the Drive trace-event vocabulary and the JSONL
  emission protocol. Instrumented drive-* skills reference this skill by name
  from their "Emit" steps for payload schemas (events.md) and file-path
  resolution + append mechanics (emission.md), so the vocabulary lives in one
  canonical place rather than in project-local docs. Use when an instrumented
  Drive skill reaches an "Emit `<event>`" step and you need the payload schema
  or append mechanics to write the trace line; when adding or changing a trace
  event type; when instrumenting a new skill with an Emit step; or when
  computing metrics from an emitted trace.jsonl.
---

# Drive: Record Traces

A **library skill** — it is not invoked to *do* work; it is read by other skills that emit trace events, and by tooling that reads them. It carries two reference documents, an executable emitter, and the rules that bind them.

## What this skill owns

- [`events.md`](./events.md) — the versioned **trace-event vocabulary**: the common envelope, every event type, its trigger condition, its emitting skill(s), its payload schema, and JSONL examples. This is the source of truth for *what an event is*. The machine-readable arktype schema lives in [`schema.ts`](./schema.ts).
- [`emission.md`](./emission.md) — the shared **emission protocol**: trace-file path resolution (in-project / orphan-slice / direct-change), append-only JSONL conventions, the deterministic `emit.ts` invocation that appends events, and the existence-check pattern that selects `*-authored` vs `*-amended` events.
- [`emit.ts`](./emit.ts) — the **deterministic emitter CLI** that enforces the vocabulary and protocol. It owns the envelope (`event_id`, `schema_version`, `ts`), validates each fully-merged event against `schema.ts` fail-closed (a malformed event exits non-zero and writes nothing), and appends exactly one compact JSON line. Instrumented skills invoke it instead of hand-appending. In this repo, `pnpm drive:emit` is the shortcut.

## Prerequisites (for the emitter)

`emit.ts` requires Node with native TypeScript execution (Node 24+) and the `arktype` package. In this repo `arktype` is already available via the workspace root `node_modules` — no extra install needed. In another repo, install it before emitting (`npm install arktype`).

## Why a library skill (not project-local docs)

Instrumentation is a property of the **skills**, not of any one project. When the vocabulary lived under a project's `docs/`, every instrumented skill's "Emit" step linked into that project — so the skill stopped being portable, and the references would dangle the moment the project closed and its directory was deleted. Co-locating the vocabulary with the skill cluster (the way `drive-agent-personas` co-locates persona definitions) gives the vocabulary a single canonical home that cross-skill consistency can be checked against. Instrumented skills then refer to it **by name** — not by a hard-coded path into this skill's files — so neither the emitting skill nor this one is coupled to the cluster's on-disk layout, and each stays independently installable.

## How instrumented skills cite this skill

An instrumented skill carries a one-to-three-line **Emit** blockquote at each workflow transition point. The blockquote names the event type, lists the payload fields the orchestrator must compute, and refers to this skill **by name** (the runtime resolves and loads it) for the schema + mechanics — no relative path:

> **Emit `{event_type}`:** Compute this event's payload fields (see the `drive-record-traces` skill — `events.md` § `{event_type}`), then invoke that skill's emitter per its `emission.md` § Append protocol: `--event {event_type} --payload '<payload-only fields>'` with `--trace-file` and `--project-run-id` from session context. The emitter owns the envelope and validates before appending.

For spec/plan writes that pick between `*-authored` and `*-amended`, the Emit step also applies the existence-check pattern in [`emission.md`](./emission.md) § Existence-check pattern.

## Instrumented skills (current)

The build loop, planning chain, and lifecycle/cadence skills emit seventeen event types:

| Skill | Events |
|---|---|
| `drive-build-workflow` | `dispatch-start`, `dispatch-end`, `round-start`, `round-end`, `brief-issued` |
| `drive-specify-project`, `drive-specify-slice` | `spec-authored`, `spec-amended` |
| `drive-plan-project`, `drive-plan-slice` | `plan-authored`, `plan-amended` |
| `drive-triage-work` | `triage-verdict` |
| `drive-discussion` | `falsified-assumption` (mid-flight I12 falsified-assumption entries only) |
| `drive-create-project` | `project-started` |
| `drive-close-project` | `project-closed` |
| `drive-deliver-workflow` | `slice-started`, `slice-completed` |
| `drive-check-health` | `health-check-fired` |
| `drive-run-retro` | `retro-landed` |
| `drive-start-workflow` | `dispatch-start`, `round-start`, `brief-issued`, `round-end`, `dispatch-end` (direct-change sub-path only — build-loop spine reuse; see `emission.md` § Direct-change build-loop spine reuse) |

The read-time assertion + diagnostic-metrics tooling extends this vocabulary in later work; additions go in [`events.md`](./events.md) under the same `schema_version` discipline (additive changes keep `"1"`; a breaking change bumps the version).

## References

- [`events.md`](./events.md) — event vocabulary.
- [`emission.md`](./emission.md) — emission protocol.
- The `drive-agent-personas` library skill — the other library skill in the cluster, for the co-location convention.
