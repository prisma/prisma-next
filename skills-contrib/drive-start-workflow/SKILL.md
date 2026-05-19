---
name: drive-start-workflow
description: >
  Workflow skill. Pilots triage + the verdict's setup chain. Routes incoming work to its
  right shape (direct change / orphan slice / in-project slice / new project / promote /
  demote / spike first / defer) and runs the immediate downstream setup. Use at every
  fresh entry into Drive (Linear ticket, bug report, customer ask, "I should do X"
  thought) AND mid-flight when scope shifts (promote / demote). Calls drive-triage-work
  for the verdict; per verdict, calls drive-create-project / drive-specify-project /
  drive-specify-slice / drive-pr-description (direct-change) / Linear MCP tools.
metadata:
  version: "2026.5.18"
---

# Drive: Start Workflow

Pilots the triage + setup chain. Workflow skill — invoked top-down and returns when the entry point has been routed to its right shape and the immediate setup is done.

```text
        Entry point (Linear ticket / bug / ask / mid-flight scope-shift signal)
                                  │
                                  ▼
                         ┌─────────────────┐
                         │ drive-triage-work │  ← decision tree → one of 8 verdicts
                         └─────────────────┘
                                  │
            ┌────────────┬────────┴────────┬──────────────┐
            ▼            ▼                 ▼              ▼
       direct change   orphan slice    in-project slice  new project
            │            │                 │              │
            ▼            ▼                 ▼              ▼
       drive-pr-      drive-specify-   drive-specify-  drive-create-
       description    slice            slice           project
       (direct-                                          │
       change framing)                                   ▼
            │                                       drive-specify-
            ▼                                       project
       gh pr create                                     │
                                                        ▼
                                                   drive-plan-
                                                   project
                                                        │
                                                        ▼
                                                   drive-deliver-
                                                   workflow

       promote (mid-flight)         demote (mid-flight)        spike first         defer
            │                            │                       │                   │
            ▼                            ▼                       ▼                   ▼
       Linear: create Project,      Linear: close other        drive-build-      record in
       move ticket in, mark         issues, move surviving     workflow with     projects/<x>/
       Done, scaffold projects/     out (project=null),        spike-flavoured   deferred.md
       <slug>/, then drive-         migrate on-disk content    brief; re-route   (or operator
       project-specify              to surviving PR body,      via drive-start-  scratch)
                                    delete projects/<x>/       workflow on
                                                               artefact
```

## When to use

Use **at every fresh entry into Drive**:

- A Linear ticket lands; the operator picks it up.
- A bug report or customer ask arrives.
- The operator notices "I should do X."
- An agent surfaces a finding that becomes its own piece of work.

Use **mid-flight when scope shifts**:

- An in-flight slice is growing beyond one PR → triage as candidate for **promote**.
- An in-flight project's remaining scope is now one PR → triage as candidate for **demote**.
- Mid-flight scope re-evaluation requested by the operator or surfaced by `drive-check-health`.

**Do not use this skill for:**

- The dispatch loop *inside* a slice — that's `drive-build-workflow`.
- The project lifecycle around slices — that's `drive-deliver-workflow`.
- Re-running triage on an already-routed unit just to double-check — that's a no-op; only re-triage when scope has actually shifted.

## Pre-conditions

- An entry-point exists: a Linear ticket, a bug report, a customer ask, a "I should do X" sentence, or a mid-flight scope-shift signal.
- For mid-flight invocations: the in-flight unit is identified (slice path, project path, or Linear ID).

## Post-conditions

- One of the eight triage verdicts has been emitted (`drive-triage-work` output).
- The verdict's setup chain has been executed:
  - **Direct change** → `drive-pr-description` (direct-change framing) drafted; `gh pr create` ready. No on-disk artefact under `projects/`.
  - **Orphan slice** → slice spec drafted inline in the PR body via `drive-specify-slice` (orphan mode); no `projects/<x>/`.
  - **In-project slice** → slice spec under `projects/<project>/slices/<slice>/spec.md` via `drive-specify-slice`; ready for `drive-build-workflow`.
  - **New project** → `projects/<project>/` scaffolded via `drive-create-project`; `projects/<project>/spec.md` drafted via `drive-specify-project`; ready for `drive-plan-project` → `drive-deliver-workflow`.
  - **Promote** → Linear Project created; original ticket moved in + marked Done + renamed `Plan: <project>`; `projects/<project>/` scaffolded; spec migration started; ready for `drive-specify-project`.
  - **Demote** → other open Linear issues closed with "merged into <surviving>" comments; surviving ticket moved out of Linear Project; Linear Project Cancelled or Completed; on-disk content migrated to surviving PR body; `projects/<project>/` deleted.
  - **Spike first** → `drive-build-workflow` invoked with a spike-flavoured brief; artefact is the DoD; re-route via `drive-start-workflow` on the artefact.
  - **Defer** → record landed in `projects/<x>/deferred.md` (if in a project) or operator scratch; control returns to the operator.

## Project context

Load `drive/triage/README.md` at workflow step 1 if it exists. This is the team's accumulated triage protocol — failure modes you've hit, sizing heuristics, ticket-shape patterns, the team's calibration for "what's a direct change here vs an orphan slice." See [`drive/README.md`](../../drive/README.md) for the protocol-as-memory two-homes architecture (canonical skill bodies vs project-context READMEs).

## Workflow

### Step 1 — Load project context

Read `drive/triage/README.md` if it exists. (If it doesn't, that's expected for repos that haven't bootstrapped the convention yet — `drive-bootstrap-context` can seed it.)

### Step 2 — Run triage

Invoke `drive-triage-work` with the entry-point input. Receive one of the eight verdicts.

### Step 3 — Confirm verdict with operator (interactive mode)

In interactive mode: present the verdict + the chosen setup chain to the operator. Wait for confirmation before proceeding (especially for promote / demote — those have Linear side-effects).

In unattended mode: proceed without confirmation but log the verdict + reasoning to `wip/unattended-decisions.md` per the unattended-mode protocol (see `drive-build-workflow` § Unattended mode).

### Step 4 — Execute the verdict's setup chain

Per the post-conditions above. Each branch is a sequence of atomic-skill calls + (where relevant) Linear MCP-tool calls + on-disk scaffolding.

#### Direct change

1. `drive-pr-description` (direct-change framing): assemble the PR body — intent statement, Linear ticket link, scope statement, brief verification note ("reviewer can verify in ~30 sec by reading the diff").
2. Sanity-check the verdict: re-read the PR description. If it doesn't fit the "30-second verifiable change" shape, escalate back to `drive-triage-work` for re-routing.
3. Return — operator runs `git checkout -b ...`, makes the edit, `gh pr create`.

#### Orphan slice

1. `drive-specify-slice` (orphan mode): slice spec drafted inline as the PR description's body. No `projects/<x>/`.
2. Return — caller invokes `drive-build-workflow` next.

#### In-project slice

1. Identify the parent project (from operator input or by inferring from open Linear Project / `projects/<project>/` matching the ticket).
2. `drive-specify-slice` (in-project mode): slice spec under `projects/<project>/slices/<slice>/spec.md`.
3. Return — caller invokes `drive-build-workflow` next.

#### New project

1. `drive-create-project`: scaffold `projects/<project>/`. Project DoR check fires (see `drive-create-project` augmentations).
2. `drive-specify-project`: project spec (often with design-discussion participation via `drive-discussion`).
3. Return — caller invokes `drive-plan-project` and then `drive-deliver-workflow`.

#### Promote (mid-flight: slice → project)

1. Create Linear Project (MCP: `linear.create_project` or equivalent).
2. Move the original Linear issue into the new Project; mark it Done; rename it `Plan: <project-slug>` (or post a comment explaining the conversion if rename is disruptive).
3. `drive-create-project` with the new slug; scaffold `projects/<project>/`.
4. Migrate the in-flight slice spec / draft into `projects/<project>/spec.md` (rough first draft; refine via `drive-specify-project`).
5. Return — caller invokes `drive-plan-project` and then `drive-deliver-workflow`.

See `model.md` § Linear sync § Promotion pattern for the canonical MCP-tool sequence.

#### Demote (mid-flight: project → slice / direct change)

1. Identify the surviving Linear issue (the one that still represents real work).
2. For each other open Linear issue in the Project: close with comment "merged into <surviving>".
3. Move the surviving issue out of the Linear Project (`project = null`).
4. Mark the Linear Project Cancelled (if no slices shipped) or Completed (if at least one shipped).
5. Migrate useful on-disk content from `projects/<project>/` into the surviving PR description (slice plan summary, edge cases, learnings).
6. Delete `projects/<project>/`.
7. Re-route the surviving work via `drive-start-workflow` (it becomes an orphan slice or direct change).

See `model.md` § Linear sync § Demotion pattern.

#### Spike first

1. `drive-build-workflow` with a spike-flavoured brief: single dispatch; DoD = "the artefact answers the planning question" not "code is committed"; artefact is a doc under `projects/<project>/spikes/<date>-<question>.md` (in-project) or `wip/spikes/...` (orphan).
2. On artefact emission: re-route via `drive-start-workflow` — the artefact carries enough information to triage the actual work to its right shape.

See `drive/triage/README.md` for spike-first conventions and team overlays.

#### Defer

1. If in a project: append an entry to `projects/<project>/deferred.md` (create if missing) with title + rationale + originating context.
2. If orphan: write to operator scratch (`wip/deferred.md` or similar).
3. Return — no action.

### Step 5 — Update Linear

Per the chosen verdict, update Linear to reflect the new state (issue / project state transitions per the patterns above). Use Linear MCP tools, not direct API calls; see `drive/triage/README.md` for the team's Linear-sync conventions.

### Step 6 — Hand off

Return control to the caller (or to the operator in interactive mode) with a one-line summary of what was routed where and what the next step is.

## Unattended mode

If invoked without an operator session (e.g. via a watchdog hook firing on a Linear-webhook event):

- Promote and demote require operator authorisation. In unattended mode, instead of executing them: log a stop-condition under `wip/unattended-decisions.md` and emit a notification surface (whatever the team uses) for the operator to pick up on return.
- Direct change / orphan slice / in-project slice / new project / spike first / defer can proceed in unattended mode; log the verdict + reasoning to `wip/unattended-decisions.md`.

## Pitfalls

1. **Triage answers "looks like a direct change" but the change isn't 30-second-verifiable.** The verdict needs a sanity check at PR-description time — if the diff is sprawling, escalate back to triage for re-routing. Direct change is a *scope* claim; the diff is the test.
2. **Promotion ceremony executed without operator authorisation.** Linear side-effects are visible to the wider team. Always confirm in interactive mode; always log + halt in unattended mode.
3. **Demotion that deletes `projects/<x>/` without migrating useful content.** The slice plan, edge cases, learnings might be load-bearing for the surviving work. Migrate to the surviving PR body before deletion.
4. **Re-triage that fires on every entry to the project loop.** Triage is for entry + scope-shift, not for double-checking. If you find yourself running triage repeatedly without a scope-shift signal, that's a workflow bug.
5. **Spike-first verdict that proceeds straight into implementation rather than into a spike dispatch.** The spike's DoD is "the artefact answers the question," not "code committed." Then the artefact triggers re-triage.

## Checklist

- [ ] Loaded `drive/triage/README.md` (if exists)
- [ ] Ran `drive-triage-work`; got a verdict
- [ ] (Interactive mode) Confirmed verdict with operator
- [ ] (Unattended mode) Logged verdict + reasoning to `wip/unattended-decisions.md`
- [ ] Executed the verdict's setup chain per § Workflow
- [ ] Updated Linear per the chosen pattern
- [ ] Handed off with a one-line summary

## Related skills

- `drive-triage-work` — runs the decision tree; this workflow calls it
- `drive-build-workflow` — pilots the slice dispatch loop after this workflow routes to an in-project slice or orphan slice
- `drive-deliver-workflow` — pilots the project lifecycle after this workflow routes to new project / promote
- `drive-discussion` — fires on design-discussion triggers during triage
- `drive-create-project`, `drive-specify-project`, `drive-specify-slice`, `drive-pr-description` — atomic skills called as setup steps
- `drive-bootstrap-context` ([PR #93](https://github.com/prisma/ignite/pull/93)) — seeds `drive/<category>/README.md` if missing

## References

- [`drive/triage/README.md`](../../drive/triage/README.md) — triage outputs, Linear-sync conventions, promotion/demotion patterns
- [`drive/plan/README.md`](../../drive/plan/README.md) — sizing discipline triage enforces
- [`drive/README.md`](../../drive/README.md) — protocol-as-memory; operators can run `drive-triage-work` manually instead of this workflow
