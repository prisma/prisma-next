---
name: drive-create-project
description: >
  Create a new transient project workspace under projects/<project>/ (folders + optional
  stub docs) AND walk the project DoR. Optionally bootstrap drive/<category>/README.md
  files if missing (delegates to drive-bootstrap-context). Then hand off to drive-
  specify-project and drive-plan-project. Use at the start of every new project AND
  during promote ceremonies (mid-flight slice→project).
metadata:
  version: "2026.5.18"
---

> **Execution mode: orchestrator-direct.** This atomic skill is invoked by the Orchestrator directly. Running it does NOT change the Orchestrator's role — the file-path boundary, stop-and-delegate triggers, and escape-hatch criterion from the active workflow skill remain in force. Outputs land in `projects/<current-project>/` (spec / plan / design notes), in Linear (via MCP), or in the conversation surface (verdicts, briefs, summaries).
>
> If the skill's body asks for work that requires reading source code, running builds/tests, or writing files outside `projects/<current-project>/` — **STOP. Dispatch.** See [`drive/roles/README.md`](../../drive/roles/README.md) for the canonical Orchestrator role definition.

# Drive: Create Project Workspace

Create the standard `projects/<project>/` structure so shaping work can start immediately and artifacts land in the right place, walk the project DoR before allowing handoff to spec authoring, and bootstrap project-context README surfaces if missing.

## When to use

- At the start of every new project.
- During promote ceremonies (mid-flight slice → project) when `drive-start-workflow` routes to "new project."

It's also useful when a developer wants to:

- Start a new project and needs the `projects/<project>/` directory scaffolded
- Create the canonical spec/plan file locations before shaping begins
- Normalize a proposed project name into a consistent kebab-case slug

## Inputs to collect (minimal)

- `{project}` slug (kebab-case). If the developer provides a name like "Payments Revamp", derive `payments-revamp` and confirm by stating the derived slug (don’t ask them to retype it).
- Whether to create stub files (default: yes)
- Whether to immediately start shaping the project spec (default: yes)

## Output layout (always)

Create (if missing):

- `projects/{project}/`
- `projects/{project}/specs/`
- `projects/{project}/plans/`
- `projects/{project}/assets/`

Notes:

- `projects/{project}/` is **transient**. At close-out: verify acceptance criteria, migrate long-lived docs (incl. ADRs for system changes) into `docs/`, then delete `projects/{project}/`.
- Because `projects/{project}/` is deleted, close-out must also **strip repo-wide references** to transient project docs (e.g. links in `docs/**`, READMEs, scripts) by replacing them with canonical `docs/` links or removing them.
- Project-level artifacts live at the project root:
  - Spec: `projects/{project}/spec.md`
  - Plan: `projects/{project}/plan.md`
  - Design notes: `projects/{project}/design-notes.md` (orchestrator-direct authored — see [`drive/roles/README.md`](../../drive/roles/README.md))

## Stub files (optional)

If stubs are requested (or defaulted) **and** the developer is **not** immediately starting shaping via `drive-create-spec`:

- `projects/{project}/spec.md` (project spec placeholder)
- `projects/{project}/plan.md` (project plan placeholder)
- `projects/{project}/design-notes.md` (project design-notes placeholder; copy from `./templates/design-notes.template.md`)

Use these minimal stubs:

### `projects/{project}/spec.md`

```markdown
# Summary

_Drafted via drive-create-spec. Replace this placeholder._

# Description

_Problem, users, scope. Replace this placeholder._

# Requirements

## Functional Requirements

## Non-Functional Requirements

## Non-goals

# Acceptance Criteria

- [ ] _Replace this placeholder_

# References

# Open Questions
```

### `projects/{project}/plan.md`

```markdown
# [Project Plan]

## Summary

_Drafted via drive-create-plan. Replace this placeholder._

**Spec:** `projects/{project}/spec.md`

## Milestones

### Milestone 1: [Name]

**Tasks:**

- [ ] _Replace this placeholder_

## Close-out (required)

- [ ] Verify all acceptance criteria in `projects/{project}/spec.md`
- [ ] Migrate long-lived docs into `docs/`
- [ ] Strip repo-wide references to `projects/{project}/**` (replace with canonical `docs/` links or remove)
- [ ] Delete `projects/{project}/`
```

### `projects/{project}/design-notes.md`

Copy from `./templates/design-notes.template.md`. The template provides the canonical section structure (principles, the model, alternatives considered, open questions, references). Design-notes is a mandatory project-level artifact, on equal footing with `spec.md` and `plan.md`, and is authored directly by the Orchestrator — see [`drive/roles/README.md`](../../drive/roles/README.md) for the orchestrator-direct authoring rule.

## Project DoR check

After scaffolding the directory and (optionally) writing stubs, walk the Project DoR (per `drive/spec/README.md` overlays and § Project DoR below). For each item, either confirm it's met or surface the gap to the operator before handoff:

- [ ] **Purpose statement** — a 1-3 sentence "why this project exists." If not yet settled, route to `drive-discussion` before allowing handoff to `drive-specify-project`.
- [ ] **Scope boundary sketch** — a rough sense of what's in and what's out (the spec will refine; DoR just needs the sketch).
- [ ] **Operator availability** — confirm the operator can participate in design discussion / spec authoring / plan review at the expected cadence. If not, the project's DoR fails; either find another operator or defer the project.
- [ ] **External dependencies known** — name any other projects, libraries, infra, or decisions this project depends on. Unknown dependencies surface as project-level open questions.
- [ ] **Linear Project** (or comparable tracker) — must exist **or** be created in the setup step below (see § Next step); assigned to the operator. Pre-existing Linear Projects are fine; if none exists yet, create one before handoff to `drive-specify-project`.

If any DoR item fails: halt and surface the gap. Do not proceed to handoff to `drive-specify-project`. DoR gates protect downstream work from setup-time costs.

## Bootstrap project-context surfaces

After DoR passes, check whether the repo has `drive/<category>/README.md` surfaces seeded for the categories the new project will use (`drive/triage/`, `drive/spec/`, `drive/plan/`, `drive/retro/`, `drive/health/`, `drive/project/`, `drive/pr/` — categories vary by repo convention).

- If yes (some / all exist): note which categories are seeded.
- If no: invoke `drive-bootstrap-context` ([PR #93](https://github.com/prisma/ignite/pull/93)) to seed the missing categories with default scaffolds. This is the "protocol-as-memory" surface; without it, lessons from this project have no project-context home to land in.

The bootstrap is non-destructive: existing `drive/<category>/README.md` files are not touched. Only missing categories get scaffolded.

## Next step (default)

If the developer wants to start shaping now (default), hand off immediately:

- Run `drive-specify-project` targeting `projects/{project}/spec.md`.
- Then run `drive-plan-project` targeting `projects/{project}/plan.md`.

(For consumers still calling the deprecated `drive-create-spec` / `drive-create-plan`, those skills now point at the split variants — handoff still works but is one indirection level deep.)

## Promote-ceremony specifics

When invoked as part of a promote ceremony (mid-flight slice → project):

- After scaffolding `projects/<project>/`, migrate the in-flight slice spec / draft content into `projects/<project>/spec.md` as the starting point for `drive-specify-project`'s refinement loop.
- The original Linear issue should already have been moved into the new Linear Project + marked Done + renamed `Plan: <project-slug>` by `drive-start-workflow` before this skill runs.
- DoR check still applies — operator availability + dependency identification are still gates.

