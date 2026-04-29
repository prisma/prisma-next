---
name: drive-create-plan
description: >
  Use when the user wants to plan a project, break a spec into milestones, generate tasks from
  a spec, or create an execution plan. Derives test cases from acceptance criteria first, then
  decomposes tasks from those tests. Optionally creates a Linear project.
metadata:
  version: "2026.4.29"
---

# Create Plan

Transform a spec into an execution plan by structuring milestones, decomposing tasks, and ensuring test coverage for every acceptance criterion. Optionally creates a corresponding project in Linear.

## File Naming

- **Project plan (from `projects/{project}/spec.md`)**: `projects/{project}/plan.md`
- **Task/feature plan (from `projects/{project}/specs/{name}.spec.md`)**: `projects/{project}/plans/{name}-plan.md`
- The plan name `{name}` matches the spec name (e.g. `pdf-export.spec.md` → `pdf-export-plan.md`).
- Avoid filenames containing `.plan.` (Cursor treats them specially).

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

- Ask: _"I need a spec to build the plan from. Want me to help create one first, or do you have a spec file I can reference?"_
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
     _"Who else needs visibility on this? (e.g. reviewers, dependent teams, product/design)"_

3. **Structure milestones.** Break the plan into milestones: significant deliverables that can be validated independently. You may adjust milestone boundaries after designing test cases in step 4 — these steps are naturally iterative. Apply these principles:
   - Each milestone should produce something demonstrable (an endpoint, a UI, a migration, a report)
   - Order milestones so each one is **safe to deploy to production immediately** — no feature flags unless explicitly required. Use implicit gates (e.g. a nullable column, a config value) so old code paths remain active until new code activates them.
   - Order milestones to ship value early; foundational work comes first
   - If the spec has natural phases or dependencies, use those as milestone boundaries
   - A plan may have 1-4 milestones; if you need more, the scope likely needs to be split into an initiative with multiple projects
   - Include a **Shipping Strategy** section in the plan that explains how backward compatibility is maintained across milestones and what acts as the implicit gate between old and new behavior.
     If the spec is too narrow for multiple milestones, use a single milestone that represents the full deliverable.

4. **Design tests from acceptance criteria.** Before decomposing tasks, derive the test cases that prove each milestone works. This is the bridge between what the spec requires and what engineers build.

   For each acceptance criterion in the spec:
   - Define one or more concrete test cases: what is being verified, the inputs/preconditions, and the expected outcome.
   - Assign a test type: unit, integration, E2E, or manual.
   - Assign each test case to the milestone whose delivery satisfies it. If a test case's setup happens in an earlier milestone than its validation (e.g. DNS monitoring configured in M1, failover tested in M4), assign it to the validation milestone and note the setup dependency in the task that provides it.

   If a criterion is ambiguous or untestable, flag it:
   _"Acceptance criterion [N] is difficult to verify automatically: [reason]. Should I refine it, or plan for manual verification?"_

   Also review the spec's non-requirement sections (security, cost, data protection, observability) for constraints that should produce test cases or inform task design. These sections often contain requirements that aren't captured as acceptance criteria but still need coverage.

   Record the full mapping in the plan's **Test Design** section before writing any tasks.

5. **Decompose tasks from tests.** For each milestone, look at the test cases assigned to it and derive the tasks that make those tests pass. Tasks exist to satisfy tests; tests exist to satisfy acceptance criteria. Every task should reference the test case(s) it addresses.

   Each task should represent **one shippable unit of work** — typically one PR or one operational step. Apply the shipping test: _"Can this ship to production independently and safely?"_ Decision or spike tasks (e.g. "resolve whether to containerize or run bare-metal") are valid tasks when they unblock downstream work — the deliverable is the decision and its rationale, not shipped code. Decision tasks don't appear in the Test Design table; they appear in the task list with the TCs they unblock (e.g. "unblocks: TC-8, TC-13").

   Task sizing principles:
   - **One task = one PR or operational step.** Don't split what ships together. If changes are tightly coupled (e.g. UI + action handler + callback that must deploy atomically), they're one task — not three.
   - **Don't over-decompose.** "Update package.json" and "fix type errors" are not separate tasks — they're part of "bump SDK." A task should be meaningful enough that an engineer would pick it up as a work unit.
   - **Don't under-decompose.** If a task has unrelated concerns that could ship independently, split them. A task that's both "add database column" and "write migration script" should be two tasks if the column ships before the script.
   - **Sequence tasks** where dependencies exist.
   - **Stay within the scope of the milestone.**
   - Be actionable and specific (not "handle auth" but "add JWT validation middleware to API gateway").

6. **Define a validation gate per milestone.** A validation gate is the explicit set of harness commands that must pass before the milestone is considered done. It exists so downstream loops (e.g. `drive-orchestrate-plan`) and humans alike know exactly which commands to run, and so milestone completion isn't ambiguous.

   For each milestone, list the commands. At minimum:
   - **Typecheck** — the project's typecheck command (e.g. `pnpm typecheck`, `npx tsc --noEmit`, `cargo check`).
   - **Test** — the test command(s) covering the milestone's surface. Package-scoped is fine when the milestone is contained; add a workspace-wide test command when the milestone deletes or renames a public export, since package-scoped tests miss consumer surfaces.
   - **Lint** — when the project has one and the milestone touches lint-relevant surfaces.
   - **Build** — when the milestone could break the build (changes to public exports, build config, codegen sources).

   If you don't know the project's harness yet, ask: _"What's the project's typecheck/test/lint/build command set? I'll record per-milestone validation gates so the loop and reviewers know what to run."_

   Record the gate in the milestone's section in the plan (see the template's **Validation gate** field). Be specific — the command should be runnable as written.

7. **Add a close-out task (required).** The final milestone (or final tasks) must include:
   - Verify all acceptance criteria are met (and link to the tests/manual checks)
   - Finalize ADRs / long-lived documentation and migrate it into `docs/`
   - Delete `projects/{project}/` (everything under it is transient)
   - If the project spec was merged, the close-out work is often done as a final PR that performs the doc migration + deletion

   The close-out task **must not** include manually closing the Linear ticket. Linear's GitHub integration auto-transitions the linked issue to the team's completed state when the close-out PR merges, provided the PR references the issue identifier (e.g. `(TML-XXXX)` in the title or `Refs: TML-XXXX` in the body) or the branch name carries it. Manual closure is redundant and risks landing the issue in the wrong completed state (e.g. `Done` instead of `Ready to be merged`). See `.agents/rules/drive-project-workflow.mdc` § "Keep Linear up to date during execution" for the full policy.

8. **Write the plan file** using the template below, saved to the `projects/{project}/` layout described above.

9. Proceed to **Refinement**.

## Refinement

After writing the initial plan, enter a refinement loop:

1. **Present gaps and assumptions in the chat window.** Format as a numbered list. Example:

   ```text
   I've drafted the plan at projects/my-proj/plans/feature-x-plan.md. A few things to resolve:

   1. The spec mentions "admin approval flow" but doesn't detail the approval states. I assumed: pending -> approved/rejected. Does this need a more complex state machine?
   2. I've listed the Platform team as a collaborator since the spec references their auth service. Should anyone specific from that team be named?
   3. Milestone 2 (UI integration) depends on design mocks. Are those available, or should I add a task to create them?
   ```

2. **Process answers.** For each answer:
   - Update the relevant plan section.
   - If the answer reveals new scope, flag it rather than silently expanding: _"That sounds like it adds [X] to scope. Should I include it or note it as a follow-up?"_
   - Adjust milestones and tasks accordingly.

3. **Repeat** until:
   - Every acceptance criterion has mapped test cases, every test case has a task, and
   - Remaining ambiguity can be resolved during execution.

4. When satisfied, confirm:
   _"The plan is ready. [N] milestones, [M] tasks total, all acceptance criteria covered. Anything to adjust?"_

5. Proceed to **Linear Integration**.

## Linear Integration

### Tooling note (important)

Linear MCP tool names and parameters are **server-specific**. In this repo, the available Linear tools come from the `user-linear` MCP server and include:

- `list_teams`
- `save_project` (create/update)
- `save_milestone` (create/update)
- `create_issue` (uses `milestone`: milestone name or ID)
- `update_issue`

Do not rely on web-enumerated tool names from other MCP server implementations; use the connected server’s tools/schemas.

After the plan is finalised, offer to create a project in Linear:

_"Want me to create this as a project in Linear? If so, which team should it go under?"_

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

4. **Create issues for deliverables, not implementation steps.** Plan tasks are granular work units; Linear issues group related tasks into deliverable-scoped units. Multiple plan tasks may map to a single Linear issue. Each issue should represent a verifiable deliverable — something you can demo, review, or ship. A milestone may contain one or several deliverable issues, but implementation details (writing a specific unit test, running a linter, wiring a handler into a router) are part of _delivering_ that issue, not separate trackable items.

   Do **not** create separate issues for:
   - Individual unit tests or test files
   - Running formatters or linters
   - Wiring/integration steps that are part of a larger deliverable
   - Any task that takes under 30 minutes of focused work on its own

   These belong in the issue description as part of the deliverable's scope.

   Use the Linear MCP `create_issue` tool:
   - `title`: a concise name for the deliverable (e.g. "Deep health: ppg-tcp-proxy endpoint and probes")
   - `team`: the selected team
   - `project`: the project name or ID
   - `milestone`: the parent milestone name or ID
   - `description`: use the structured format below

   **Issue description format:**

   ```markdown
   ## What to do

   <Specific steps the engineer will execute. Concrete enough to work from without re-reading the spec.>

   ## Why

   <Rationale with explicit spec references (e.g. "spec FR-3", "spec NFR-2"). Explain why this task exists and what it unblocks.>

   ## Plan task

   <Plan task number, e.g. "1.3">
   ```

   **Anti-pattern (from real experience):** A deep health check plan with 7 milestones was initially created as 68 Linear issues — one per individual task (each probe, each unit test, each "run go fmt" step). This created noise, made milestones unreadable, and required a full cleanup to consolidate into well-scoped deliverable issues. The detailed task breakdown belongs in the plan document; Linear tracks deliverables, not implementation steps.

5. **Estimates.** Do not add estimates during initial ticket creation. After all tickets are created, propose estimates to the engineer as a table for review. Expect pushback — estimates should be challenged and revised before applying. When proposing estimates, consider:
   - Prior art: Does a POC or spike already exist? That reduces the estimate.
   - Context accumulation: Later tasks benefit from context built during earlier ones.
   - Consolidation: If two tasks always ship together, they should be one ticket with one estimate.

6. **Confirm creation.** Report what was created:
   _"Created project [name] in Linear with [N] milestones and [M] issues. [link if available]"_

## Linear upkeep (after changes)

Linear is an observability mechanism for execution health. If the plan changes after Linear has been created (re-sequencing tasks, splitting work, new constraints), keep Linear in sync:

- Use `save_project` (with `id` to update) to refresh the Linear project's summary and link it to the current spec/plan paths.
- When milestone names, descriptions, or ordering change, apply the change via `save_milestone` (with `id` to update).
- For task-level changes, call `update_issue` to keep title/description/milestone/project in sync. Move issues into in-progress / in-review states during execution if it helps visibility, but **don't manually transition issues to a completed state** — that happens automatically when the linked PR merges, provided the PR or branch references the issue identifier.

## Plan Template

Use this structure for every plan. Remove placeholder guidance when filling in real content.

```markdown
# [Plan Name]

## Summary

_Synthesise from the spec: what is being built, why, and what success looks like. 2-4 sentences max._

**Spec:** _[relative path to spec file]_

## Collaborators

| Role         | Person/Team            | Context                    |
| ------------ | ---------------------- | -------------------------- |
| Maker        | _Project owner_        | _Drives execution_         |
| Reviewer     | _Senior peer_          | _Architectural review_     |
| Collaborator | _Affected team/person_ | _Why they need visibility_ |

## Shipping Strategy

_Explain how every milestone is backward-compatible and safe to deploy immediately. Identify the implicit gate (e.g. a nullable column, a config value, dead code) that separates old behavior from new. No feature flags unless explicitly required._

## Test Design

_Derive test cases from the spec's acceptance criteria before decomposing tasks. Tasks flow from these tests. The AC column references an acceptance criterion number (e.g. AC-1) or a spec section name (e.g. Security, Data Protection) for test cases derived from non-requirement sections._

| AC     | TC     | Test Case                | Type                                | Milestone     | Expected Outcome           |
| ------ | ------ | ------------------------ | ----------------------------------- | ------------- | -------------------------- |
| _AC-1_ | _TC-1_ | _What is being verified_ | _Unit / Integration / E2E / Manual_ | _Milestone N_ | _Specific expected result_ |

## Milestones

### Milestone 1: [Name]

_Brief description of what this milestone delivers and how it can be validated._

**Tasks:**

- [ ] _Task description (satisfies: TC-1, TC-2)_
- [ ] _Task description (satisfies: TC-3)_
- [ ] _Task description_

**Validation gate:** _Commands that must all pass before this milestone is done. Include typecheck, test (package- or workspace-scoped per the milestone), lint and build when applicable. Be specific — the commands should be runnable as written._

- _`<typecheck command>`_
- _`<test command>`_
- _`<lint command>`_

### Milestone 2: [Name]

_Brief description of what this milestone delivers and how it can be validated._

**Tasks:**

- [ ] _Task description (satisfies: TC-4, TC-5)_
- [ ] _Task description (satisfies: TC-6)_
- [ ] _Task description_

**Validation gate:**

- _`<typecheck command>`_
- _`<test command>`_
- _`<lint command>`_

## Open Items

_Decisions deferred to execution, known risks, or dependencies that need monitoring. Carry forward unresolved open questions from the spec._
```

## Guidelines

**Do:**

- Derive everything possible from the spec before asking the engineer. The spec is the input; the plan is the output.
- Keep milestones focused on deliverables, not activities. "API endpoint deployed" not "work on backend".
- Write tasks that an agent could execute without additional context beyond the spec and plan.
- Sequence tasks within milestones when dependencies exist.
- Design test cases from acceptance criteria before decomposing tasks. Tasks flow from tests; tests flow from acceptance criteria. This sequence is non-negotiable.
- Flag scope creep explicitly. If a task doesn't trace back to the spec, call it out.
- Carry forward unresolved open questions from the spec into the plan's Open Items.
- Keep Linear issue state aligned with active work, but don't manually transition issues to a completed state. GitHub integration should complete linked issues when the corresponding PR merges.
- Publish Linear project status updates at milestone boundaries: at the end of a milestone (work complete, ready for merge/review) and at the start of the next (previous milestone closed, new milestone scope).

**Don't:**

- Re-ask questions the spec already answers.
- Create milestones that can't be independently validated or demonstrated.
- Generate vague tasks like "implement feature" or "set up infrastructure". Be specific.
- Silently expand scope beyond what the spec defines. If something is needed but not in the spec, surface it.
- Skip the Linear integration offer. Always ask after the plan is finalised.
- Leave acceptance criteria without mapped test cases.
- **Create Linear issues for implementation steps.** Linear tracks deliverables, not implementation steps. Testing, verification, and wiring are part of delivering a feature — not separate trackable items. Keep Linear clean; keep the plan detailed.
- **Over-decompose into sub-step tickets.** "Update package.json", "fix type errors", and "verify build" are not three tickets — they're one ticket: "Bump SDK." Each ticket should be a meaningful work unit an engineer picks up, not a checklist item.
- **Create tickets without context.** Every Linear issue must have "What to do", "Why" (with spec references), and "Plan task" mapping. An engineer picking up the ticket cold should understand the work without re-reading the entire plan.
- **Add estimates during initial creation.** Propose estimates separately after tickets exist so they can be challenged and revised. Estimates are a conversation, not a declaration.
