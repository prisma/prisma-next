---
name: drive-specify-project
description: >
  Capture a settled project design as projects/<project>/spec.md. The spec carries
  durable system-level intent (purpose, non-goals, place in the world, cross-cutting
  requirements, transitional-shape constraints, project-DoD) — not per-slice detail
  or sequencing detail. Use after design discussion has settled the project's what
  + why, before scaffolding slices. Hands off to drive-plan-project.
metadata:
  version: "2026.5.28"
  split_from: drive-create-spec
---

> **Execution mode: orchestrator-direct.** Atomic skill invoked by the Orchestrator
> directly. Read-only codebase investigation (Grep / Read / Glob / SemanticSearch)
> is permitted and expected. If the body would require running builds/tests or
> writing files outside `projects/<current-project>/` — **STOP. Dispatch.** See
> [`drive/roles/README.md`](../../drive/roles/README.md).

# Drive: Specify Project

The project spec carries **only the things that are true at the system level** — the things that would be lost if you stripped them down to individual slice specs. Per-slice detail lives in slice specs; sequencing detail lives in the project plan; the team-DoD floor lives in [`drive/calibration/dod.md`](../../drive/calibration/dod.md) and is inherited (not restated).

**Rule of thumb.** If a section could move down a level — to the project plan or to a slice spec — without losing information, it belongs down a level.

The spec template lives at [`./templates/spec.template.md`](./templates/spec.template.md). Fill it; don't author from scratch.

## Workflow

### Step 1 — Load context

Read `drive/spec/README.md`, `drive/project/README.md`, and [`drive/calibration/dod.md`](../../drive/calibration/dod.md) if they exist. These carry team-specific spec conventions, project-level overlays, and the team-DoD floor every project inherits.

### Step 2 — Confirm the design is settled

Before drafting, the operator + agent must already agree on:

- Purpose (what the project exists to accomplish).
- Non-goals (what the project deliberately does NOT do).
- Project-DoD conditions (even if not yet phrased).
- Transitional-shape constraints, or that there are none.

If any answer is "we don't know yet," route back to `drive-discussion`. A spec written over an unsettled design will mislead every downstream slice.

### Step 3 — Ground in the codebase

Look up the surfaces the spec will reference — systems it integrates with, architectural neighbours, existing surfaces this project layers on. Surfacing "I haven't checked yet" as an open question is not acceptable; either resolve against the codebase or convert the gap into a design decision the codebase can't answer.

### Step 4 — Fill the template

Open [`./templates/spec.template.md`](./templates/spec.template.md) and fill it in this order: Purpose → At a glance → Non-goals → Place in the larger world → Cross-cutting requirements → Transitional-shape constraints → Project-DoD → Open questions → References.

If you find yourself reaching for a "Functional requirements" or "Constraints + assumptions" section, stop and ask whether each item belongs in (a) cross-cutting requirements — true at system level; (b) transitional-shape constraints — a shape rule for intermediate states; or (c) the slice that delivers it — true at slice level only. There is no fourth category.

### Step 5 — Refine, then hand off

Surface open questions to the operator; process answers; update the spec. If a question reveals a fundamental design call is still open, stop and route to `drive-discussion`. When the spec is settled, hand off to `drive-plan-project`.

## Pitfalls

1. **Purpose statement that's actually a scope description.** *"Build a CLI to export Postgres data to S3"* is scope. Purpose is *why* — *"Give operators a self-service path to extract production data without DBA involvement."* The why is immutable; the what (CLI vs API vs cron) can evolve within the same purpose.
2. **Reaching for the FR / NFR / Constraints+Assumptions template.** Those sections existed to make every spec look the same; they fill with prose nobody re-reads. Apply the rule-of-thumb: anything also true at the slice level belongs in the slice spec, not here.
3. **Non-goals left implicit.** Without explicit non-goals, scope drifts as new ideas surface during execution. Naming non-goals is what makes scope-shift visible per invariant I2.
4. **Project-DoD that re-types the team-DoD floor.** Inherit it; don't paste it in. Stale copies drift from the canonical version.
5. **Project-DoD that restates requirements.** Requirements describe what the project delivers; DoD describes the verifiable conditions under which the project closes. *"All capabilities implemented"* isn't useful; *"Demo runs through the new flow without manual intervention"* is.
6. **Drafting over an unsettled design.** Symptom: refinement-loop questions hit fundamentals (*"actually, what user is this for?"*). Stop and route to `drive-discussion`.

## References

- [`./templates/spec.template.md`](./templates/spec.template.md) — the fillable template.
- [`docs/drive/principles/sizing.md`](../../docs/drive/principles/sizing.md) — project-INVEST at the project altitude.
- [`drive/calibration/dod.md`](../../drive/calibration/dod.md) — team-DoD floor inherited by every project's DoD.
- [`docs/drive/model.md`](../../docs/drive/model.md) § Layer 5 — invariants I7 (immutable purpose), I2 (scope discipline).
