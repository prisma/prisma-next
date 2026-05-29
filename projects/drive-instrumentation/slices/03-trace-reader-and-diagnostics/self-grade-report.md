# Drive Diagnostics Report

**Trace:** projects/drive-instrumentation/trace.jsonl
**Events:** 59
**Run IDs:** drive-instrumentation
**Origin:** native

---

## Metrics

### Rework

| Metric | Value |
| --- | --- |
| rounds per dispatch (mean) | 1.00 |
| first-pass acceptance rate | 100.0% |
| backtrack ratio | 0.000 |
| brief stability (overall) | initial: 11 |
| tier mix | claude-4.6-sonnet-high-thinking: 11 |
| dispatch wallclock (mean) | 616909 ms |
| dispatch wallclock (total) | 6786000 ms |
| round wallclock (rounds) | 11 |
| round wallclock (total) | 6786000 ms |

### Planning Quality

| Metric | Value |
| --- | --- |
| spec stability (count) | 0 |
| spec stability (reasons) | (none) |
| plan accuracy (count) | 0 |
| plan accuracy (reasons) | (none) |
| dispatch size distributions | S:0 M:5 L:0 XL:0; S:0 M:7 L:0 XL:0 |
| I12 halt rate (count) | 0 |
| I12 triggered by | (none) |
| triage stability | n/a (no signal) — no triage-verdict events |

### Artefact Churn

| Metric | Value |
| --- | --- |
| write amplification (mean) | 1.00 |
| write amplification (paths) | projects/drive-instrumentation/slices/02-lifecycle-cadence-and-direct-change/plan.md: 1, projects/drive-instrumentation/slices/02-lifecycle-cadence-and-direct-change/spec.md: 1, projects/drive-instrumentation/slices/03-trace-reader-and-diagnostics/plan.md: 1, projects/drive-instrumentation/slices/03-trace-reader-and-diagnostics/spec.md: 1 |
| time to stability | projects/drive-instrumentation/slices/02-lifecycle-cadence-and-direct-change/plan.md: 0 ms, projects/drive-instrumentation/slices/02-lifecycle-cadence-and-direct-change/spec.md: 0 ms, projects/drive-instrumentation/slices/03-trace-reader-and-diagnostics/plan.md: 0 ms, projects/drive-instrumentation/slices/03-trace-reader-and-diagnostics/spec.md: 0 ms |

### Lifecycle

| Metric | Value |
| --- | --- |
| project wallclock | n/a (no signal) — no project-started event |
| slice wallclock | n/a (no signal) — no slice-started or slice-completed events |
| health checks (count) | 0 |
| health checks (cadence) | (none) |
| health checks (max severity) | n/a (no signal) — no health-check-fired events |
| retros (count) | 0 |
| retros (trigger classes) | (none) |
| retros (landing surfaces) | (none) |

### Operator

| Metric | Value |
| --- | --- |
| operator turn count | n/a (no signal) — post-hoc only — no native operator-turn event exists in slice 1 |

---

## Assertions

### Pass (7)

| ID | Title |
| --- | --- |
| BD-8 | Brief restates the slice spec (over-long brief). |
| Cascade-3 | Triage produces one of three delivery shapes: direct-change, slice, or project. |
| I1 | A slice or direct change delivers exactly one PR. |
| I10 | Every project has a DoD declared in its project spec. |
| I4 | A project has at least one slice or direct change. |
| I6 | A slice's spec and plan exist before implementation begins; a direct change has no spec/plan. |
| I8 | Every dispatch has a DoD in its brief AND a DoR satisfied before it starts. |

### Fail (0)

| ID | Title | Evidence |
| --- | --- | --- |

### Not Checkable (24)

| ID | Title | Rationale |
| --- | --- | --- |
| BD-1 | "Do what's needed" briefs — no Task, no Scope, no Completed when. | The trace captures brief_byte_length, content_hash, and disposition only; brief content sections (Task, Scope, Completed when, etc.) are not emitted. |
| BD-10 | Standing instruction rephrased as "minimize changes" (trains executor timidity). | The trace captures brief_byte_length, content_hash, and disposition only; brief content sections (Task, Scope, Completed when, etc.) are not emitted. |
| BD-11 | Brief composed by a subagent (inflates context, inverts cost model). | Who authored the brief is not recorded in the trace. |
| BD-2 | Brief omits "Completed when" section. | The trace captures brief_byte_length, content_hash, and disposition only; brief content sections (Task, Scope, Completed when, etc.) are not emitted. |
| BD-3 | Brief omits "Out of scope" list. | The trace captures brief_byte_length, content_hash, and disposition only; brief content sections (Task, Scope, Completed when, etc.) are not emitted. |
| BD-4 | Brief pre-decomposes every file the executor will touch. | The trace captures brief_byte_length, content_hash, and disposition only; brief content sections (Task, Scope, Completed when, etc.) are not emitted. |
| BD-5 | Brief pre-walks every edge case "to be safe". | The trace captures brief_byte_length, content_hash, and disposition only; brief content sections (Task, Scope, Completed when, etc.) are not emitted. |
| BD-6 | Brief has wishlist "Completed when" entries (not verifiable, not binary). | The trace captures brief_byte_length, content_hash, and disposition only; brief content sections (Task, Scope, Completed when, etc.) are not emitted. |
| BD-7 | Brief omits model tier ("Operational metadata" section absent or unpopulated). | The trace captures brief_byte_length, content_hash, and disposition only; brief content sections (Task, Scope, Completed when, etc.) are not emitted. |
| BD-9 | Executor silently rewrites the brief (orchestrator owns the brief). | Silent brief rewrites cannot be detected from the trace; amended dispositions confirm surfaced rewrites (positive evidence). |
| Cascade-1 | Project, slice, and dispatch each get their own template, sized to their limiting constraint. | Template usage is an authoring-time property; no trace event records which template was used at each level. |
| Cascade-2 | Content lives at the lowest artifact level where it does not lose information. | Content placement across artifact levels is an authoring judgment; no trace event captures where content was placed. |
| Cascade-4 | Discussion is signal-triggered, not mandatory. | Cannot detect when discussion should have been triggered but was skipped; falsified-assumption events are positive evidence the halt-and-discuss path fired. |
| Cascade-5 | The executor's standing instruction is "stay focused on the goal; control scope". | Brief text content is not captured in the trace; whether the standing instruction is present and verbatim is not-checkable. |
| Cascade-6 | The reviewer does not re-run validation commands during routine review. | No trace event records reviewer actions; whether validation commands were re-run cannot be verified. |
| Cascade-7 | The team-level Definition of Done lives in project context (drive/calibration/dod.md), not in the skill body. | Skill body content is not captured in the trace; where the team-level DoD is defined cannot be verified. |
| Cascade-8 | Internal project labels stay out of operator-facing communication. | PR body text, Linear ticket content, and commit message text are not captured in the trace. |
| I11 | Sizing applies at two altitudes by logical coherence (INVEST), not by logistical footprint. | Sizing by INVEST is a human/agent judgment call; no trace event captures whether a unit passed INVEST. |
| I12 | Spec or plan amendments after the first dispatch starts are operator-driven or design-discussion output; silent agent-side amendments are forbidden. | Can confirm the halt-and-discuss path fired via falsified-assumption events, but cannot detect silent amendments. |
| I2 | A project's scope is bounded by its project spec at all times. | No trace event records scope expansion or contraction relative to the project spec. |
| I3 | Every spec and plan has exactly one scope-type (project or slice), immutable after creation. | spec_kind is recorded at authoring time but no event signals a retroactive scope-type change. |
| I5 | A slice or direct change may or may not have a parent project (orphan units are allowed). | Whether a slice or direct change is orphan cannot be inferred from project_run_id alone. |
| I7 | A project's purpose statement is immutable after the first slice or direct change starts. | No trace event records changes to a project's purpose statement; immutability cannot be verified. |
| I9 | Every slice has a DoD declared in its slice spec or inherited from its parent project. | Cannot distinguish a slice spec with zero dod_items from one legitimately inheriting project DoD. |
