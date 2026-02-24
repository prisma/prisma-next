---
name: drive-generate-plan
description: >
  Generate an execution plan from a spec, with milestones, tasks, and test coverage for all
  acceptance criteria. Use when the user wants to plan a project, break a spec into milestones,
  generate tasks from a spec, or create an execution plan. Optionally creates a Linear project.
metadata:
  version: "2026.2.23"
---

# Generate Plan

Transform a spec into an execution plan by structuring milestones, decomposing tasks, and ensuring test coverage for every acceptance criterion. Optionally creates a corresponding project in Linear.

## File Naming

- **Project plan (from `projects/{project}/spec.md`)**: `projects/{project}/plans/plan.md`
- **Task/feature plan (from `projects/{project}/specs/{name}.spec.md`)**: `projects/{project}/plans/{name}.plan.md`
- The plan name `{name}` matches the spec name (e.g. `pdf-export.spec.md` → `pdf-export.plan.md`).

## Entry Points

Determine which entry point applies:

### 1. Spec provided

The engineer provides a spec file path or references an existing spec.

- Read the spec in full.
- Proceed to **Drafting**.

### 2. Spec referenced in conversation

The engineer has been working on a spec in the current conversation (e.g. via `drive-create-spec`).

- Use the spec content from the conversation context.
- Confirm the spec file path with the engineer.
- Proceed to **Drafting**.

### 3. No spec available

The engineer asks to generate a plan but no spec exists.

- Ask: *"I need a spec to build the plan from. Want me to help create one first, or do you have a spec file I can reference?"*
- If they want to create a spec, hand off to `drive-create-spec`. By default, project shaping produces `projects/{project}/spec.md`, and task/feature specs go to `projects/{project}/specs/{name}.spec.md`.
- Once a spec exists, proceed to **Drafting**.

## Drafting

Given a spec, generate the full plan:

1. **Derive the summary.** Synthesise the spec into a concise plan summary: what is being built, why it matters, and what success looks like. Derive this from the spec's summary, description, and requirements; do not ask the engineer for it.

2. **Identify collaborators.** Pull collaborators from:
   - The spec's collaborators section (if present)
   - Anyone mentioned in references or open questions
   - Teams or individuals whose systems are affected by the requirements
   If the spec doesn't name collaborators or affected parties, ask:
   *"Who else needs visibility on this? (e.g. reviewers, dependent teams, product/design)"*

3. **Structure milestones.** Break the plan into milestones: significant deliverables that can be validated independently. Apply these principles:
   - Each milestone should produce something demonstrable (an endpoint, a UI, a migration, a report)
   - Order milestones to ship value early; foundational work comes first
   - If the spec has natural phases or dependencies, use those as milestone boundaries
   - A plan may have 1-4 milestones; if you need more, the scope likely needs to be split into an initiative with multiple projects
   If the spec is too narrow for multiple milestones, use a single milestone that represents the full deliverable.

4. **Decompose tasks per milestone.** For each milestone, generate concrete tasks that an engineer or agent can pick up and execute. Tasks should:
   - Be actionable and specific (not "handle auth" but "add JWT validation middleware to API gateway")
   - Be sequenced where dependencies exist
   - Include integration, documentation, and testing tasks where the spec implies them
   - Stay within the scope of the milestone

5. **Add test tasks for every acceptance criterion.** Review the spec's acceptance criteria and ensure every criterion has at least one corresponding test task in the plan. Add a dedicated section or weave tests into the relevant milestone. If a criterion cannot be tested automatically, note it as requiring manual verification. Flag any acceptance criteria that are ambiguous or untestable:
   *"Acceptance criterion [N] is difficult to verify automatically: [reason]. Should I refine it, or plan for manual verification?"*

6. **Add a close-out task (required).** The final milestone (or final tasks) must include:
   - Verify all acceptance criteria are met (and link to the tests/manual checks)
   - Finalize ADRs / long-lived documentation and migrate it into `docs/`
   - Delete `projects/{project}/` (everything under it is transient)
   - If the project spec was merged, the close-out work is often done as a final PR that performs the doc migration + deletion

7. **Write the plan file** using the template below, saved to the `projects/{project}/` layout described above.

8. Proceed to **Refinement**.

## Refinement

After writing the initial plan, enter a refinement loop:

1. **Present gaps and assumptions in the chat window.** Format as a numbered list. Example:

   ```
   I've drafted the plan at projects/my-proj/plans/feature-x.plan.md. A few things to resolve:

   1. The spec mentions "admin approval flow" but doesn't detail the approval states. I assumed: pending -> approved/rejected. Does this need a more complex state machine?
   2. I've listed the Platform team as a collaborator since the spec references their auth service. Should anyone specific from that team be named?
   3. Milestone 2 (UI integration) depends on design mocks. Are those available, or should I add a task to create them?
   ```

2. **Process answers.** For each answer:
   - Update the relevant plan section.
   - If the answer reveals new scope, flag it rather than silently expanding: *"That sounds like it adds [X] to scope. Should I include it or note it as a follow-up?"*
   - Adjust milestones and tasks accordingly.

3. **Repeat** until:
   - Every acceptance criterion has a mapped test, and
   - Remaining ambiguity can be resolved during execution.

4. When satisfied, confirm:
   *"The plan is ready. [N] milestones, [M] tasks total, all acceptance criteria covered. Anything to adjust?"*

5. Proceed to **Linear Integration**.

## Linear Integration

After the plan is finalised, offer to create a project in Linear:

*"Want me to create this as a project in Linear? If so, which team should it go under?"*

If the engineer declines, the plan document is the final artifact. Stop here.

If the engineer accepts:

1. **Resolve the team.** If the engineer provides a team name, use it. If unsure, list available teams using the Linear MCP `list_teams` tool and let the engineer pick.

2. **Create the project.** Use the Linear MCP `save_project` tool:
   - `name`: the project name from the plan
   - `team`: the selected team
   - `description`: the plan summary, with a reference to the spec and plan file paths
   - `state`: "planned"

3. **Create milestones.** For each milestone in the plan, use the Linear MCP `save_milestone` tool:
   - `project`: the project name or ID from step 2
   - `name`: the milestone name
   - `description`: the milestone description from the plan

4. **Create issues (tasks).** For each task in the plan, use the Linear MCP `create_issue` tool:
   - `title`: the task description
   - `team`: the selected team
   - `project`: the project name or ID
   - `milestone`: the parent milestone name or ID
   - `description`: include a reference back to the plan and spec files

5. **Confirm creation.** Report what was created:
   *"Created project [name] in Linear with [N] milestones and [M] issues. [link if available]"*

## Plan Template

Use this structure for every plan. Remove placeholder guidance when filling in real content.

```markdown
# [Plan Name]

## Summary

_Synthesise from the spec: what is being built, why, and what success looks like. 2-4 sentences max._

**Spec:** _[relative path to spec file]_

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | _Project owner_ | _Drives execution_ |
| Reviewer | _Senior peer_ | _Architectural review_ |
| Collaborator | _Affected team/person_ | _Why they need visibility_ |

## Milestones

### Milestone 1: [Name]

_Brief description of what this milestone delivers and how it can be validated._

**Tasks:**

- [ ] _Specific, actionable task_
- [ ] _Specific, actionable task_
- [ ] _Specific, actionable task_

### Milestone 2: [Name]

_Brief description of what this milestone delivers and how it can be validated._

**Tasks:**

- [ ] _Specific, actionable task_
- [ ] _Specific, actionable task_
- [ ] _Specific, actionable task_

## Test Coverage

_Map every acceptance criterion from the spec to at least one test. If a criterion requires manual verification, note it explicitly._

| Acceptance Criterion | Test Type | Task/Milestone | Notes |
|---|---|---|---|
| _Criterion from spec_ | _Unit / Integration / E2E / Manual_ | _Reference to task_ | _Any caveats_ |

## Open Items

_Decisions deferred to execution, known risks, or dependencies that need monitoring. Carry forward unresolved open questions from the spec._
```

## Guidelines

**Do:**

- Derive everything possible from the spec before asking the engineer. The spec is the input; the plan is the output.
- Keep milestones focused on deliverables, not activities. "API endpoint deployed" not "work on backend".
- Write tasks that an agent could execute without additional context beyond the spec and plan.
- Sequence tasks within milestones when dependencies exist.
- Ensure every acceptance criterion from the spec has a corresponding test task. This is non-negotiable.
- Flag scope creep explicitly. If a task doesn't trace back to the spec, call it out.
- Carry forward unresolved open questions from the spec into the plan's Open Items.

**Don't:**

- Re-ask questions the spec already answers.
- Create milestones that can't be independently validated or demonstrated.
- Generate vague tasks like "implement feature" or "set up infrastructure". Be specific.
- Silently expand scope beyond what the spec defines. If something is needed but not in the spec, surface it.
- Skip the Linear integration offer. Always ask after the plan is finalised.
- Leave acceptance criteria without mapped tests.
