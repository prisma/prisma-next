---
name: drive-specify-project
description: >
  Capture a settled project design as projects/<project>/spec.md. A project spec carries
  durable intent (purpose, non-goals, place in the larger world, cross-cutting requirements,
  transitional-shape constraints) — not per-slice detail or sequencing detail. Use after
  design discussion has settled the project's what + why, before scaffolding slices.
metadata:
  version: "2026.5.28"
  split_from: drive-create-spec
---

> **Execution mode: orchestrator-direct.** This atomic skill is invoked by the Orchestrator directly. Running it does NOT change the Orchestrator's role — the file-path boundary, stop-and-delegate triggers, and escape-hatch criterion from the active workflow skill remain in force.
>
> Read-only codebase investigation (Grep / Read / Glob / SemanticSearch) is **permitted and expected** — the skill body requires grounding plans in actual codebase state. If the skill's body asks for work that requires running builds/tests or writing files outside `projects/<current-project>/` — **STOP. Dispatch.** See [`drive/roles/README.md`](../../drive/roles/README.md).

# Drive: Specify Project

Capture a settled project design as `projects/<project>/spec.md`. A project spec carries **only the things that are true at the system level** — things that would be lost if you stripped them down to individual slice specs.

The shape:

- **Purpose** — what this project exists to accomplish; immutable after the first dispatch starts (invariant I7).
- **Non-goals** — what this project deliberately does NOT do (scope-protection).
- **Place in the larger world** — external systems, libraries, projects this project integrates with or depends on; how this project fits the codebase's architecture.
- **Cross-cutting requirements** — capabilities or constraints no single slice carries on its own (e.g. *"every slice in this project leaves the system deployable"*, *"the new feature is reachable via the documented CLI surface end-to-end"*).
- **Transitional-shape constraints** — constraints on the shape of intermediate states between slices (*"each merged slice keeps CI green on `main`"*, *"no breaking change without a deprecation window of at least one minor release"*).
- **Project-DoD** — verifiable conditions under which the project closes.

A project spec does **not** carry: per-slice detail (lives in slice specs), sequencing detail (lives in the project plan), or separate FR / NFR / Constraints+Assumptions ceremony sections (fold items that matter into the sections above; drop the rest).

**Rule of thumb:** if a section could move down a level (to the project plan or to a slice spec) without losing information, it belongs down the level.

## When to use

- After `drive-start-workflow` routed to "project" or "promote" and the project has been scaffolded by `drive-create-project`.
- After a `drive-discussion` session has settled the project's purpose, non-goals, and approach.
- When picking up an existing project whose spec needs to be re-authored (e.g. mid-flight scope shift required a new spec round).

**Do not use this skill for:**

- Slice-level specs — that's `drive-specify-slice`.
- Facilitating design discussion — that's `drive-discussion`.
- Project plans (slice composition + sequencing) — that's `drive-plan-project`.

## Pre-conditions

- `projects/<project>/` exists (typically scaffolded by `drive-create-project`).
- The project's purpose has been settled (via `drive-discussion` or operator-provided framing).
- For mid-flight re-spec scenarios: the existing spec is identified and the operator has authorised the rewrite per invariant I12.

## Post-conditions

- `projects/<project>/spec.md` exists; carries purpose, non-goals, place in the larger world, cross-cutting requirements, transitional-shape constraints, project-DoD.
- Purpose statement is explicit and minimal (≤ 3 sentences); per I7 it's the contract for the project's lifetime.
- Non-goals are explicit, not implied.
- Project-DoD lists verifiable conditions (each binary; each observable).

## Project context

Load `drive/spec/README.md`, `drive/project/README.md`, and the team-DoD-floor doc (this repo: `drive/calibration/dod.md`; other repos may use `drive/done/README.md`) at workflow step 1 if they exist. These carry the team's project-spec conventions, the project-level overlays, and **the team-level DoD floor** (inherited by every project's DoD — added on top, not restated).

## Workflow

### Step 1 — Load project context

Read `drive/spec/README.md`, `drive/project/README.md`, and the team-DoD floor doc if they exist.

### Step 2 — Confirm the design is settled

Before drafting:

- Is the purpose clear and shared between operator + agent?
- Are non-goals known (or knowable)?
- Are the project-DoD conditions known (even if not yet phrased)?
- Are the transitional-shape constraints that affect every slice stated explicitly (or N/A)?

If any answer is "no," route back to `drive-discussion` before drafting. A project spec written over an unsettled design will mislead every downstream slice.

### Step 3 — Research codebase state the spec will anchor on

Before drafting, look up the surfaces the spec will reference — the systems it integrates with, the architectural neighbours, the existing surfaces this project layers on. Use Grep / Read / Glob / SemanticSearch. **Surfacing "I haven't checked yet" as an open question is not acceptable** — either resolve against the codebase or note the question as a design decision the codebase cannot answer.

### Step 4 — Draft the spec

Use the **Project Spec Template** below. Drafting order:

1. **Purpose** (≤ 3 sentences). The most important part. The minimum that captures *why this project exists.* Test: if this changed, the project's identity would change.
2. **At a glance.** A tight, concrete section anchoring the reader. Prose, code sample, Mermaid diagram, before/after worked example — whichever makes the design tangible. Two questions the reader answers on a single skim: *what is happening* and *why should I care.* Don't flatten into a fact sheet.
3. **Non-goals.** Explicit list of what's out. Scope-protection.
4. **Place in the larger world.** External systems, libraries, sibling projects; architectural fit; integration / API contracts.
5. **Cross-cutting requirements.** Capabilities or constraints no individual slice carries.
6. **Transitional-shape constraints.** Constraints on intermediate states between slices (deployability, backward-compat, observability during migration). Mark "N/A — single-slice project" if there are none.
7. **Project-DoD.** Verifiable, binary conditions. Inherit the team's DoD floor from the team-DoD doc (this repo: `drive/calibration/dod.md`); add project-specific conditions on top.
8. **References.** Linear Project, ADRs, sibling projects, design-discussion records.

If you find yourself wanting to write a "Functional requirements" or "Constraints + assumptions" section: stop and ask whether each item belongs in cross-cutting requirements (yes if true at system level), transitional-shape constraints (yes if a shape rule for intermediate states), or *the slice that delivers it* (yes if true at slice level only).

### Step 5 — Refinement loop

Surface open questions to the operator; process answers; update the spec; loop until no project-level questions remain. If a refinement question reveals a fundamental design decision is still open, stop and route to `drive-discussion`.

### Step 6 — Hand off

Hand off to `drive-plan-project` for slice composition + sequencing.

## Project Spec Template

```markdown
# <project-name>

## Purpose

_≤ 3 sentences. Immutable after first dispatch starts (invariant I7). The minimum that captures why this project exists. Test: if this changed, the project's identity would change._

## At a glance

_A tight, concrete section anchoring the reader. Prose, code sample, Mermaid, or worked example — whichever makes the design tangible. Reader answers two questions on a single skim: what's happening, and why care._

## Non-goals

_Explicit list of what this project deliberately does NOT do. Scope-protection. Examples: phase-2 items, adjacent surfaces left alone, scope other projects own._

## Place in the larger world

_External systems, libraries, sibling projects this project integrates with or depends on. Architectural fit. Integration / API contracts. References to ADRs that constrain the project's shape._

## Cross-cutting requirements

_Capabilities or constraints no single slice carries on its own. Examples: "every merged slice leaves the system deployable", "the new feature is reachable end-to-end via the documented CLI", "instrumentation continues to satisfy ADR-XX's tracing contract throughout"._

## Transitional-shape constraints

_Constraints on intermediate states between slices. Examples: "no breaking change without a deprecation window of at least one minor release", "every slice keeps CI green on `main`", "no `main` branch outage longer than 30 minutes during the migration"._

_If the project has no transitional-shape constraints (e.g. ship-as-one-slice projects), say "N/A — single-slice project" and move on._

## Project Definition of Done

_Verifiable, binary conditions for closing this project. Inherit the team's DoD floor (this repo: `drive/calibration/dod.md`). Add project-specific conditions on top. Each condition observable._

- [ ] _Team-DoD floor items (inherited; see team-DoD doc for the canonical list)._
- [ ] _Project-specific condition 1._
- [ ] _Project-specific condition 2._

## Open Questions

_Residual design-level questions the project ships with as known-unresolved. Each with a working position so the operator can confirm or override. Questions whose answers would change Purpose belong in design discussion, not here._

1. _Question._ Working position: _..._

## References

- Linear Project: _link_
- Sibling / dependent projects: _..._
- ADRs: _..._
- Design-discussion records: _..._
```

## Pitfalls

1. **Purpose statement that's actually a scope description.** *"Build a CLI to export Postgres data to S3"* is scope, not purpose. Purpose is *why* — *"Give operators a self-service path to extract production data for downstream analytics, without DBA involvement."* The why is what's immutable; the what (CLI vs API vs cron) can evolve within the same purpose.
2. **Reaching for the FR / NFR / Constraints+Assumptions template.** Those sections existed to make every project spec look the same; they're noise when they fill with prose nobody re-reads. Apply the rule: anything that's also true at the slice level belongs in the slice spec, not here.
3. **Non-goals left implicit.** Without explicit non-goals, the project's scope drifts as new ideas surface during execution. Naming non-goals is what makes scope-shift visible per invariant I2.
4. **Project-DoD that restates requirements.** Requirements describe what the project delivers; DoD describes the verifiable conditions under which the project closes. *"All capabilities implemented"* isn't a useful DoD item; *"Demo runs through the new flow without manual intervention"* is.
5. **Project-DoD that re-types the team-DoD floor.** Inherit from `drive/done/README.md`; don't paste-in. Stale copies of the floor drift from the canonical version.
6. **Drafting a spec over an unsettled design.** Symptom: refinement-loop questions hit fundamentals (*"actually, what user is this for?"*). Stop and route to `drive-discussion`.
7. **Transitional-shape constraints baked into the plan instead of the spec.** *"We'll deploy this without downtime"* is a *requirement* not a *plan choice* — the plan documents how the constraint is met, but the constraint itself lives in the spec where it can outlast plan rewrites.

## Checklist

- [ ] Loaded `drive/spec/README.md`, `drive/project/README.md`, team-DoD floor doc (if exist)
- [ ] Confirmed the design is settled (routed back to `drive-discussion` if not)
- [ ] Researched codebase state the spec will anchor on
- [ ] Purpose ≤ 3 sentences; captures *why*, not *what*
- [ ] At-a-glance is concrete (prose / code / diagram / worked example), not a fact sheet
- [ ] Non-goals explicit
- [ ] Place in the larger world named (external systems, sibling projects, architectural fit)
- [ ] Cross-cutting requirements listed (or explicit N/A)
- [ ] Transitional-shape constraints listed (or explicit N/A)
- [ ] Project-DoD: inherits team floor + project-specific conditions; each binary and observable

## Related skills

- `drive-create-project` — scaffolds `projects/<project>/`; runs before this skill
- `drive-discussion` — fires when the design isn't settled; resolves design questions then hands back here
- `drive-plan-project` — composes slices + direct changes; runs after this skill
- `drive-specify-slice` — slice-level variant; different template (concrete chosen design + coherence rationale, not durable system intent)

## References

- [`docs/drive/design-decisions/2026-05-28-artefact-cascade-redesign.md`](../../docs/drive/design-decisions/2026-05-28-artefact-cascade-redesign.md) — the redesign that stripped FR / NFR / Constraints ceremony, introduced transitional-shape constraints + place-in-larger-world, and pinned the team-DoD-inheritance rule
- [`drive/spec/README.md`](../../drive/spec/README.md) — project-spec authoring overlays
- [`drive/calibration/dod.md`](../../drive/calibration/dod.md) — team's project-DoD floor (inherited by every project's spec in this repo)
- Invariant I7 (immutable purpose after first dispatch) — enforced by this skill and `drive-discussion` stop-conditions
