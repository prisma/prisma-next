---
name: drive-specify-project
description: >
  Capture a settled project design as an unambiguous project spec. A project spec carries
  the project's purpose statement (immutable after first dispatch starts, per invariant
  I7), scope boundary, and project-DoD. Use after design discussion has settled the
  project's what + why, before scaffolding slices. Split from drive-create-spec; the slice
  variant is drive-specify-slice.
metadata:
  version: "2026.5.18"
  split_from: drive-create-spec
---

> **Execution mode: orchestrator-direct.** This atomic skill is invoked by the Orchestrator directly. Running it does NOT change the Orchestrator's role — the file-path boundary, stop-and-delegate triggers, and escape-hatch criterion from the active workflow skill remain in force. Outputs land in `projects/<current-project>/` (spec / plan / design notes), in Linear (via MCP), or in the conversation surface (verdicts, briefs, summaries).
>
> If the skill's body asks for work that requires reading source code, running builds/tests, or writing files outside `projects/<current-project>/` — **STOP. Dispatch.** See [`drive/roles/README.md`](../../drive/roles/README.md) for the canonical Orchestrator role definition.

# Drive: Specify Project

Capture a settled project design as `projects/<project>/spec.md`. A project spec carries:

- **Purpose statement** — what this project exists to accomplish; immutable after the first dispatch starts (invariant I7).
- **Scope boundary** — what's in, what's out, with deliberate non-goals listed.
- **Project-DoD** — the verifiable conditions under which the project closes.
- **Constraints + assumptions** — what the project assumes about the world; what's pinned by other systems.
- **Risk / open questions** — design-level residual risks the project ships with; questions surfaced for design discussion.

This skill is the **output** of the project design phase, not part of it. If significant design questions remain, resolve them in a design discussion (`drive-discussion`) before invoking this one. Refinement here is for tightening ambiguity in the *recorded* design, not for re-opening it.

## When to use

- After `drive-start-workflow` routed to "new project" or "promote" and the project has been scaffolded by `drive-create-project`.
- After a `drive-discussion` session has settled the project's purpose, scope, and approach.
- When picking up an existing project whose spec needs to be re-authored (e.g. mid-flight scope shift required a new spec round).

**Do not use this skill for:**

- Slice-level specs — that's `drive-specify-slice` (scope within a project; ≤ 1 PR; Example-Mapping edge cases).
- Facilitating design discussion — that's `drive-discussion`.
- Project plans (slice composition + sequencing) — that's `drive-plan-project`.

## Pre-conditions

- `projects/<project>/` exists (typically scaffolded by `drive-create-project`).
- The project's purpose has been settled (via `drive-discussion` or operator-provided framing).
- For mid-flight re-spec scenarios: the existing spec is identified and the operator has authorised the rewrite per invariant I12.

## Post-conditions

- `projects/<project>/spec.md` exists and carries: purpose, scope boundary, project-DoD, constraints + assumptions, open questions (with working positions where possible).
- Purpose statement is explicit and minimal (1-3 sentences); per I7 it's the contract for the project's lifetime.
- Scope boundary names what's in AND what's deliberately out (Non-goals).
- Project-DoD lists verifiable conditions (each one binary; each one observable).
- Project DoR (per `drive/spec/README.md` overlays and § Project DoR in this skill) is met or its gaps are recorded as open questions.

## Project context

Load `drive/spec/README.md` + `drive/project/README.md` at workflow step 1 if they exist. These carry the team's project-spec conventions — required sections beyond the template, team-specific examples, anti-pattern catalogue, the team's discipline around purpose-statement framing.

## Workflow

### Step 1 — Load project context

Read `drive/spec/README.md` + `drive/project/README.md` if they exist.

### Step 2 — Confirm the design is settled

Before drafting, confirm the design questions are resolved. Specifically:

- Is the purpose statement clear and shared between operator + agent?
- Is the scope boundary defined (in scope AND non-goals)?
- Are the project-DoD conditions known (even if not yet phrased)?
- Are the load-bearing assumptions explicit?

If any answer is "no," route back to `drive-discussion` before drafting. A project spec written over an unsettled design will mislead every downstream slice.

### Step 3 — Research codebase state the spec will anchor on

Before drafting, look up the DSL surfaces, IR shapes, package boundaries, and call sites the spec is going to reference. Use Grep / Read / Glob / SemanticSearch to ground claims about what exists today, what's named what, which call sites would change. **Surfacing "I haven't checked yet" as an open question is not acceptable** — either resolve against the codebase or note the question as a design decision the codebase cannot answer.

### Step 4 — Draft the spec

Use the **Project Spec Template** below. Drafting order matters:

1. **Purpose statement** (≤ 3 sentences). The most important part of the spec. Pin the minimum that captures *why this project exists.* Test: if this sentence changed, the project's identity would change. Use that test to keep it minimal.
2. **At a glance.** A tight, concrete section anchoring the reader. Two questions the reader should be able to answer on a single skim: *what is happening in this project* and *why should I care*. Pick whatever form makes the design tangible — prose, prose + small code sample, prose + Mermaid diagram, before/after worked example. Don't flatten into a fact sheet.
3. **Scope boundary.** What's in (the requirements the project commits to). What's deliberately out (the Non-goals — natural phase-2 items, adjacent surface deliberately left alone, scope that other projects own).
4. **Project-DoD.** Verifiable, binary conditions. *"All slices in the plan delivered or explicitly deferred"*, *"Mandatory final retro complete with landed output"*, *"Long-lived docs migrated into `docs/`; `projects/<project>/` deleted"*, plus project-specific conditions (e.g., *"Demo runs through the new flow without manual intervention"*).
5. **Approach.** 2-4 paragraphs on the settled solution at the level of capabilities + shape, not implementation. Mermaid diagrams welcome; code snippets when they convey an interface, schema, or algorithm clearly.
6. **Functional requirements** (FR1, FR2, ...). Capabilities the project will deliver. *What*, not *how*.
7. **Non-functional requirements** (NFR1, NFR2, ...). Performance, observability, cost, security, data-protection targets where applicable.
8. **Constraints + assumptions.** What the project assumes about the world. Each load-bearing assumption named explicitly — these are the candidates for falsification per invariant I12.
9. **Open questions.** Residual design-level questions for design discussion or downstream slices. Each with a working position so the operator can confirm or override.
10. **References.** Linear ticket / parent Project, ADRs the project layers on, external standards referenced.

### Step 5 — Refinement loop

Present open questions to the operator (numbered list); process answers; update spec; loop until no design-level questions remain. If a refinement question reveals a fundamental design decision is still open, stop and route to `drive-discussion`.

### Step 6 — Confirm DoR

Walk through Project DoR (per `drive/spec/README.md` overlays and § Project DoR in this skill). Either confirm each item is met, or record gaps as open questions / pending design discussion.

### Step 7 — Hand off

Hand off to `drive-plan-project` for slice composition + sequencing.

## Project Spec Template

```markdown
# Summary

_1-3 sentence synthesis of the project's purpose + what it ships._

# Purpose

_≤ 3 sentences. Immutable after first dispatch starts (invariant I7). The minimum that captures why this project exists. Test: if this changed, the project's identity would change._

# At a glance

_A tight, concrete section anchoring the reader. Prose, code sample, Mermaid diagram, or worked example — whichever makes the design tangible. Reader answers two questions on a single skim: what's happening, and why care._

# Scope

## In scope

_The requirements the project commits to. Concrete + bounded._

## Non-goals

_Deliberately out: phase-2 items, adjacent surfaces left alone, scope other projects own._

# Approach

_2-4 paragraphs at the level of capabilities + shape, not implementation. Mermaid welcome. Code snippets when they convey an interface, schema, or algorithm clearly._

# Project Definition of Done

_Verifiable, binary conditions for closing this project. Each one observable. Example items below; specialise for the project._

- [ ] **PDoD1.** All slices in the project plan delivered or explicitly deferred (in `projects/<project>/deferred.md`).
- [ ] **PDoD2.** Manual-QA coverage across user-observable surfaces; no unresolved 🛑 Blocker findings.
- [ ] **PDoD3.** Mandatory final retro complete; output landed in canonical / project-context / ADR.
- [ ] **PDoD4.** Long-lived docs (ADRs, subsystem docs) migrated into `docs/`.
- [ ] **PDoD5.** Repo-wide references to `projects/<project>/**` removed / replaced with `docs/` links.
- [ ] **PDoD6.** `projects/<project>/` deleted.
- [ ] **PDoD7.** Linear Project marked Completed (or Cancelled per demotion).
- [ ] _(Project-specific) e.g._ **PDoD8.** _Demo runs end-to-end without manual intervention._

# Functional Requirements

- **FR1.** _Capability_
- **FR2.** _Capability_

# Non-Functional Requirements

- **NFR1.** _Performance / observability / cost / security / data-protection target where applicable_
- **NFR2.** _..._

# Constraints + Assumptions

_Each load-bearing assumption named explicitly — these are I12-relevant candidates for falsification._

- **A1.** _Assumption_
- **A2.** _Assumption_

# Open Questions

_Residual design-level questions. Each with a working position so the operator can confirm / override. Questions whose answers would change Purpose belong in design discussion, not here._

1. _Question._ Working position: _..._
2. _Question._ Working position: _..._

# References

- Linear Project: _link_
- Parent / sibling projects: _..._
- ADRs: _..._
- Reference material: _..._
```

## Pitfalls

1. **Purpose statement that's actually a scope description.** *"Build a CLI to export Postgres data to S3"* is scope, not purpose. Purpose is *why* — *"Give operators a self-service path to extract production data for downstream analytics, without DBA involvement."* The why is what's immutable; the what (CLI vs API vs cron) can evolve within the same purpose.
2. **Project-DoD that restates requirements.** Requirements describe what the project delivers; DoD describes the verifiable conditions under which the project closes. *"All FRs implemented"* isn't a useful DoD item; *"Demo runs through the new flow without manual intervention"* is.
3. **Non-goals left implicit.** Without explicit non-goals, the project's scope drifts as new ideas surface during execution. Naming non-goals is what makes scope-shift visible per invariant I2.
4. **Drafting a spec over an unsettled design.** Symptom: refinement-loop questions hit fundamentals (*"actually, what user is this for?"*). Stop and route to `drive-discussion`.
5. **Open questions that should be slice-level decisions.** If an open question can be answered by a slice's implementer without changing the project's purpose / scope / DoD, it belongs in the slice spec, not here.
6. **Skipping the DoR check.** Project DoR exists so a project doesn't start mid-air. Skipping it makes the first slice's setup the de-facto DoR pass — costly when DoR fails late.

## Checklist

- [ ] Loaded `drive/spec/README.md` + `drive/project/README.md` (if exist)
- [ ] Confirmed the design is settled (routed back to `drive-discussion` if not)
- [ ] Researched codebase state the spec will anchor on
- [ ] Purpose statement is ≤ 3 sentences and captures *why*, not *what*
- [ ] At-a-glance section is concrete (prose / code / diagram / worked example), not a fact sheet
- [ ] Scope: both in-scope FRs/NFRs AND deliberate non-goals
- [ ] Project-DoD: verifiable, binary conditions (not restated requirements)
- [ ] Constraints + assumptions explicit; load-bearing ones named for I12
- [ ] Open questions carry working positions
- [ ] Project DoR walked; gaps either resolved or surfaced
- [ ] Refinement loop completed; remaining items are intentional degrees of freedom

## Related skills

- `drive-create-project` — scaffolds `projects/<project>/`; runs before this skill
- `drive-discussion` — fires when the design isn't settled; resolves design questions then hands back here
- `drive-plan-project` — composes slices + direct changes; runs after this skill
- `drive-specify-slice` — slice-level variant; different inputs / outputs / templates

## References

- [`drive/spec/README.md`](../../drive/spec/README.md) — project-spec authoring overlays, DoR / DoD conventions
- [`drive/project/README.md`](../../drive/project/README.md) — project-level conventions
- Invariants I7 (immutable purpose after first dispatch) and I12 (no silent spec amendments) — enforced by this skill and `drive-discussion` stop-conditions
