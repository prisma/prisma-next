# Agile Agent Orchestration

A protocol for orchestrating agent-driven software development using Agile practices adapted for agent teams.

## Motivation

Agent-driven development exhibits the same failure modes as human team development — estimation drift, scope creep, spec drift, context loss between hand-offs, coordination overhead — but faster, and without the organic memory transmission that human teams rely on to learn from mistakes.

The protocol adapts well-established Agile practices (relative estimation, time-boxing, standup checks, Definition of Ready / Done, spikes) to a setting where the team is composed of a human orchestrator + one or more agent implementers, and where institutional memory must live in written rituals rather than shared experience.

## Status

Early shaping. Documents are being recorded as the protocol is developed during real project work.

## Documents

- [`spec.md`](spec.md) — problem statement and high-level approach
- [`design-decisions.md`](design-decisions.md) — record of decisions made during shaping; updated as we converge
- [`principles/protocol-as-memory.md`](principles/protocol-as-memory.md) — why agent teams must capture lessons in rituals
- [`principles/decomposition-and-cost.md`](principles/decomposition-and-cost.md) — why smaller dispatches enable cheaper tiers
- [`principles/spikes.md`](principles/spikes.md) — time-boxed investigations with artefact output
- [`calibration/prisma-next.md`](calibration/prisma-next.md) — example project-specific calibration

## How this project relates to others

This is a **methodology project**. Its output is a general protocol that any project can adopt by writing project-specific calibrations (rubric anchors, DoD checklists, failure-mode catalogues). The protocol layer is general; the calibration layer is per-project.

The protocol is being developed in the context of the `prisma-next` project, which serves as the first calibration example. Prisma-next-specific calibrations will eventually live in `prisma-next`'s `docs/` (not here).

### Relationship with existing `drive-*` skills

This methodology fills the sizing-discipline gap in the existing `drive-*` skill suite:

- **`drive-create-plan`** produces the project plan. Under this methodology, plans must produce M-sized tasks with explicit validation gates and edge-case dispositions. L/XL tasks must be decomposed at planning time.
- **`drive-orchestrate-plan`** runs the implement-review loop. It already covers the execution contract (persistent subagents, heartbeats, validation gates, findings discipline, multitasking, unattended mode). It does **not** cover the sizing discipline (no L/XL refusal, no 5-min orchestrator-side inspection, no t-shirt estimation). This methodology supplies those rules.

Both skills will eventually link to this methodology (likely renaming the methodology to `drive/agile-*` once stabilised). See `spec.md § Integration with existing skills` for the gate-mapping table.

### Eventual home

When the methodology stabilises, it lives in the centralized `drive/agile` skill namespace (the same way `drive-create-plan` and `drive-orchestrate-plan` are centralized today). Project-specific calibrations live in each adopting repo's `docs/`. See `spec.md § Settled questions`.
