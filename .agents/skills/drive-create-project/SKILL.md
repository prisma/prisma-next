---
name: drive-create-project
description: >
  Create a new transient project workspace under projects/<project>/ (folders + optional stub docs),
  then hand off to drive-create-spec / drive-generate-plan.
metadata:
  version: "2026.3.1"
---

# Create Project Workspace

Create the standard `projects/<project>/` structure so shaping work can start immediately and artifacts land in the right place.

## When to use

Use at the start of every new project. This is the expected first step before writing the project spec and plan.

It’s also useful when a developer wants to:

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

## Stub files (optional)

If stubs are requested (or defaulted) **and** the developer is **not** immediately starting shaping via `drive-create-spec`:

- `projects/{project}/spec.md` (project spec placeholder)
- `projects/{project}/plan.md` (project plan placeholder)

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

_Drafted via drive-generate-plan. Replace this placeholder._

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

## Next step (default)

If the developer wants to start shaping now (default), hand off immediately:

- Run `drive-create-spec` targeting `projects/{project}/spec.md`
- Then run `drive-generate-plan` targeting `projects/{project}/plan.md`

