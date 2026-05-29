---
name: drive-record-traces
description: >
  Library skill that owns the Drive trace-event vocabulary and the JSONL
  emission protocol. Instrumented drive-* skills cite this skill's events.md
  (payload schemas) and emission.md (file-path resolution + append mechanics)
  from their "Emit" steps, so the vocabulary lives in one canonical place that
  travels with the skill cluster rather than in project-local docs. Use when
  adding or changing a trace event type, instrumenting a new skill with an
  Emit step, or computing metrics from an emitted trace.jsonl.
---

# Drive: Record Traces

A **library skill** — it is not invoked to *do* work; it is read by other skills that emit trace events, and by tooling that reads them. It carries two reference documents and the rules that bind them.

## What this skill owns

- [`events.md`](./events.md) — the versioned **trace-event vocabulary**: the common envelope, every event type, its trigger condition, its emitting skill(s), its payload schema (with arktype types), and JSONL examples. This is the source of truth for *what an event is*.
- [`emission.md`](./emission.md) — the shared **emission protocol**: trace-file path resolution (in-project / orphan-slice / direct-change), append-only JSONL conventions, the canonical `Shell` + `printf … >>` append mechanic, and the existence-check pattern that selects `*-authored` vs `*-amended` events.

## Why a library skill (not project-local docs)

Instrumentation is a property of the **skills**, not of any one project. When the vocabulary lived under a project's `docs/`, every instrumented skill's "Emit" step linked into that project — so the skill stopped being portable, and the references would dangle the moment the project closed and its directory was deleted. Co-locating the vocabulary with the skill cluster (the way `drive-agent-personas` co-locates persona definitions) keeps each instrumented skill's "Emit" step resolvable wherever the `skills-contrib/` cluster is installed, and gives the vocabulary a single canonical home that cross-skill consistency can be checked against.

## How instrumented skills cite this skill

An instrumented skill carries a one-to-three-line **Emit** blockquote at each workflow transition point. The blockquote names the event type, lists the payload fields the orchestrator must compute, and links here for the schema + mechanics. Sibling-path form from another `skills-contrib/<skill>/SKILL.md`:

> **Emit `{event_type}`:** Build the envelope (`event_id`, `schema_version: "1"`, `ts`, `project_run_id`, `orchestrator_agent_id`) plus this event's payload fields (see [`../drive-record-traces/events.md`](../drive-record-traces/events.md) § `{event_type}`). Append one JSON line per [`../drive-record-traces/emission.md`](../drive-record-traces/emission.md) § Append protocol.

For spec/plan writes that pick between `*-authored` and `*-amended`, the Emit step also applies the existence-check pattern in [`emission.md`](./emission.md) § Existence-check pattern.

## Instrumented skills (current)

The build loop and the planning chain emit eleven event types:

| Skill | Events |
|---|---|
| `drive-build-workflow` | `dispatch-start`, `dispatch-end`, `round-start`, `round-end`, `brief-issued` |
| `drive-specify-project`, `drive-specify-slice` | `spec-authored`, `spec-amended` |
| `drive-plan-project`, `drive-plan-slice` | `plan-authored`, `plan-amended` |
| `drive-triage-work` | `triage-verdict` |
| `drive-discussion` | `falsified-assumption` (mid-flight I12 falsified-assumption entries only) |

Lifecycle / cadence / direct-change instrumentation and the read-time assertion + diagnostic-metrics tooling extend this vocabulary in later work; additions go in [`events.md`](./events.md) under the same `schema_version` discipline (additive changes keep `"1"`; a breaking change bumps the version).

## References

- [`events.md`](./events.md) — event vocabulary.
- [`emission.md`](./emission.md) — emission protocol.
- [`../drive-agent-personas/SKILL.md`](../drive-agent-personas/SKILL.md) — the other library skill in the cluster, for the co-location convention.
