---
name: drive-start-workflow
description: >
  Workflow skill. Pilots triage + the verdict's setup chain. Routes incoming work to its
  right shape (direct change / slice / project) and executes the immediate downstream
  setup. Also handles state-machine transitions on in-flight work (promote / demote /
  spike / defer). Use at every fresh entry into Drive (Linear ticket, bug report,
  customer ask, "I should do X" thought) AND mid-flight when scope shifts. Calls
  drive-triage-work for the verdict; per verdict, calls drive-create-project /
  drive-specify-project / drive-specify-slice / drive-pr-description (direct-change) /
  Linear MCP tools.
metadata:
  version: "2026.5.28"
---

# Drive: Start Workflow

Pilots triage + setup chain. Workflow skill — invoked top-down and returns when the entry-point has been routed and the immediate setup is done.

> **You are an Orchestrator.** This workflow skill puts you in the Orchestrator role for its entire body (see [`drive/roles/README.md`](../../drive/roles/README.md)). Your verbs: **delegate**, **synthesize**, **coordinate**, **decide**, and **author** project / slice artifacts directly.
>
> **File-path boundary:** your file writes only land inside `projects/<current-project>/`. Writing to `src/`, `tests/`, `docs/`, `skills-contrib/`, `drive/`, `.cursor/`, or any other path is the signal that the work must be **delegated** to an Executor with the spec as their input contract. Reads outside the project directory are fine; writes are not.
>
> **Stop-and-delegate triggers:** if you are about to call `Read`/`Grep`/`Glob` on source code, `Shell` for build/test/lint, or `Write`/`StrReplace` on a file outside `projects/<current-project>/` — **STOP. Dispatch.** See [`drive/roles/README.md § DO-NOT enumeration`](../../drive/roles/README.md#do-not-enumeration-for-the-orchestrator).
>
> **Escape hatch** (rare, brief, navigational): single-tool-call coordination acts are fine. Log the use.

```text
        Entry point (Linear ticket / bug / ask / mid-flight scope-shift)
                                  │
                                  ▼
                         ┌───────────────────┐
                         │ Signal check      │  ← discussion-mode signals?
                         └───────────────────┘
                                  │
                  signal fires    │    no signal
                       │          │       │
                       ▼          │       ▼
                drive-discussion  │  drive-triage-work
                       │          │       │
                       └──────────┘       ▼
                                  ┌───────────────────┐
                                  │ Verdict           │
                                  └───────────────────┘
                                  │
        ┌──────────┬──────────────┼──────────────────┬─────────┬───────┐
        ▼          ▼              ▼                  ▼         ▼       ▼
   direct        slice          project           promote/   spike   defer
   change                                          demote
        │          │              │                  │         │       │
        ▼          ▼              ▼                  ▼         ▼       ▼
   drive-pr-   drive-       drive-create-      Linear MCP  drive-   record in
   description specify-     project +          + scaffold  build-   projects/
   (direct-    slice        drive-specify-     migration   workflow <x>/
   change)     (orphan      project            +/- delete  with     deferred.md
        │     | in-project)        │            project    spike    or operator
        ▼          │              ▼              dir       brief    scratch
   gh pr      drive-build-   drive-plan-                    │
   create     workflow       project                        ▼
                                  │                       re-route via
                                  ▼                       drive-start-
                             drive-deliver-               workflow on
                             workflow                     artefact
```

## When to use

Use **at every fresh entry into Drive** — a Linear ticket lands, a bug report or customer ask arrives, the operator notices "I should do X," or an agent surfaces a finding that becomes its own piece of work.

Use **mid-flight when scope shifts** — an in-flight slice is growing beyond one PR (candidate for promote), an in-flight project's remaining scope is now one PR (candidate for demote), or `drive-check-health` surfaces a scope-shift signal.

**Do not use this skill for:**

- The dispatch loop *inside* a slice (that's `drive-build-workflow`).
- The project lifecycle around slices (that's `drive-deliver-workflow`).
- Re-running triage on an already-routed unit just to double-check.

## Pre-conditions

- An entry-point exists: a Linear ticket, a bug report, a customer ask, a "I should do X" sentence, or a mid-flight scope-shift signal.
- For mid-flight invocations: the in-flight unit is identified (slice path, project path, or Linear ID).

## Post-conditions

The verdict's setup chain has been executed, and one of the following is true:

- **Direct change** → `drive-pr-description` (direct-change framing) drafted; `gh pr create` ready. No on-disk artefact under `projects/`.
- **Slice (orphan)** → slice spec drafted inline in the PR body via `drive-specify-slice` (orphan mode); no `projects/<x>/`.
- **Slice (in-project)** → slice spec under `projects/<project>/slices/<slice>/spec.md` via `drive-specify-slice`; ready for `drive-build-workflow`.
- **Project** → `projects/<project>/` scaffolded via `drive-create-project`; `projects/<project>/spec.md` drafted via `drive-specify-project`; ready for `drive-plan-project` → `drive-deliver-workflow`.
- **Promote** → Linear Project created; original ticket moved in + marked Done + renamed; `projects/<project>/` scaffolded; spec migration started; ready for `drive-specify-project`.
- **Demote** → other open Linear issues closed with "merged into <surviving>" comments; surviving ticket moved out of Linear Project; Linear Project Cancelled or Completed; on-disk content migrated to surviving PR body; `projects/<project>/` deleted.
- **Spike** → `drive-build-workflow` invoked with a spike-flavoured brief; artefact is the DoD; re-route via `drive-start-workflow` on the artefact.
- **Defer** → record landed in `projects/<x>/deferred.md` (if in a project) or operator scratch.

## Project context

Load `drive/triage/README.md` at workflow step 1 if it exists. The team's accumulated triage protocol: failure modes hit, sizing heuristics, ticket-shape patterns, calibration for "what's a direct change here vs an orphan slice." See [`drive/README.md`](../../drive/README.md) for the two-homes architecture (canonical skill bodies vs project-context READMEs).

## Workflow

### Step 1 — Load project context

Read `drive/triage/README.md` if it exists.

### Step 2 — Check discussion-mode signals; route if any fire

Before triage, scan the entry-point for the signals listed in `drive-triage-work` § Step 2:

- Design ambiguity in the ticket.
- Surface uncertainty (first-grep returns more files than expected; unfamiliar area).
- Parent-project assumption at risk.

If any signal fires, route to `drive-discussion` first; the discussion may sharpen the entry-point before triage runs.

### Step 3 — Run triage

Invoke `drive-triage-work` with the (possibly discussion-sharpened) entry-point input. Receive one verdict.

### Step 4 — Decide and execute (default); confirm only when authorisation required

**Decide and execute by default.** For direct change / slice / spike / defer verdicts (and project verdicts where the spec sketch matches the ticket scope), proceed to Step 5 without operator confirmation. Log the verdict + one-line rationale in the chat output so the operator sees what was decided.

**Confirm with operator for:**

- **Promote / demote** (Linear side-effects are visible).
- **Project** when the orchestrator's spec sketch suggests significantly more work than the ticket text implied (operator may want to re-scope, defer parts, or split).

In interactive mode: present the verdict + setup chain; wait for confirmation. In unattended mode: log a stop-condition under `wip/unattended-decisions.md` and emit a notification surface for the operator to pick up on return.

### Step 5 — Execute the verdict's setup chain

Per the post-conditions above. Each branch is a sequence of atomic-skill calls + (where relevant) Linear MCP-tool calls + on-disk scaffolding.

#### Direct change

1. `drive-pr-description` (direct-change framing): assemble the PR body — intent statement, Linear ticket link, scope statement, brief verification note ("reviewer can verify in ~30 sec by reading the diff").
2. Sanity-check the verdict: re-read the PR description. If it doesn't fit the 30-second-verifiable shape, escalate back to `drive-triage-work` for re-routing.
3. Dispatch an Implementer with the direct-change brief (branch from `main`, edit, commit, `gh pr create`). Return when the dispatched sub-agent reports the PR is open.

#### Slice (orphan or in-project)

1. Determine sub-mode: **orphan** (default) or **in-project** (iff a parent `projects/<project>/` exists for this purpose AND the slice's spec relies on the project context to make sense).
2. `drive-specify-slice` (mode per sub-decision): slice spec inline in PR description (orphan) or at `projects/<project>/slices/<slice>/spec.md` (in-project).
3. Return — caller invokes `drive-build-workflow` next.

#### Project

1. `drive-create-project`: scaffold `projects/<project>/`. Project DoR check fires.
2. `drive-specify-project`: project spec (often with design-discussion participation via `drive-discussion`).
3. Return — caller invokes `drive-plan-project` and then `drive-deliver-workflow`.

#### Promote (mid-flight: slice → project)

1. Create Linear Project (MCP: `linear.create_project` or equivalent).
2. Move the original Linear issue into the new Project; mark it Done; rename it `Plan: <project-slug>` (or post a comment explaining the conversion if rename is disruptive).
3. `drive-create-project` with the new slug; scaffold `projects/<project>/`.
4. Migrate the in-flight slice spec / draft into `projects/<project>/spec.md` (rough first draft; refine via `drive-specify-project`).
5. Return — caller invokes `drive-plan-project` and then `drive-deliver-workflow`.

See `model.md` § Tracker sync § Promotion pattern for the canonical tool-call sequence.

#### Demote (mid-flight: project → slice / direct change)

1. Identify the surviving Linear issue (the one that still represents real work).
2. For each other open Linear issue in the Project: close with comment "merged into <surviving>".
3. Move the surviving issue out of the Linear Project (`project = null`).
4. Mark the Linear Project Cancelled (if no slices shipped) or Completed (if at least one shipped).
5. Migrate useful on-disk content from `projects/<project>/` into the surviving PR description (slice plan summary, edge cases, learnings).
6. Delete `projects/<project>/`.
7. Re-route the surviving work via `drive-start-workflow` (it becomes an orphan slice or direct change).

See `model.md` § Tracker sync § Demotion pattern.

#### Spike

1. `drive-build-workflow` with a spike-flavoured brief: single dispatch; DoD = "the artefact answers the planning question" not "code is committed"; artefact is a doc under `projects/<project>/spikes/<date>-<question>.md` (in-project) or `wip/spikes/...` (orphan).
2. On artefact emission: re-route via `drive-start-workflow` — the artefact carries enough information to triage the actual work to its right shape.

See `drive/triage/README.md` for spike-first conventions and team overlays.

#### Defer

1. If in a project: append an entry to `projects/<project>/deferred.md` (create if missing) with title + rationale + originating context.
2. If orphan: write to operator scratch (`wip/deferred.md` or similar).
3. Return — no action.

### Step 6 — Update Linear

Per the chosen verdict, update Linear to reflect the new state (issue / project state transitions per the patterns above). Use Linear MCP tools, not direct API calls; see `drive/triage/README.md` for the team's Linear-sync conventions.

### Step 7 — Hand off

Return control to the caller (or to the operator in interactive mode) with a one-line summary of what was routed where and what the next step is.

## Unattended mode

If invoked without an operator session (e.g. via a watchdog hook firing on a Linear-webhook event):

- **Promote, demote, and operator-flagged Project verdicts** require operator authorisation. In unattended mode: log a stop-condition under `wip/unattended-decisions.md` and emit a notification surface for the operator to pick up on return.
- Direct change / slice / spike / defer / Project (non-flagged) can proceed; log the verdict + reasoning to `wip/unattended-decisions.md`.

## Pitfalls

1. **Triage answers "looks like a direct change" but the change isn't 30-second-verifiable.** The verdict needs a sanity check at PR-description time — if the diff is sprawling, escalate back to triage for re-routing. Direct change is a *scope* claim; the diff is the test.
2. **Promotion ceremony executed without operator authorisation.** Linear side-effects are visible to the wider team. Always confirm in interactive mode; always log + halt in unattended mode.
3. **Demotion that deletes `projects/<x>/` without migrating useful content.** The slice plan, edge cases, learnings might be load-bearing for the surviving work. Migrate to the surviving PR body before deletion.
4. **Re-triage that fires on every entry to the project loop.** Triage is for entry + scope-shift, not for double-checking. If you find yourself running triage repeatedly without a scope-shift signal, that's a workflow bug.
5. **Spike verdict that proceeds straight into implementation rather than into a spike dispatch.** The spike's DoD is "the artefact answers the question," not "code committed." Then the artefact triggers re-triage.
6. **Skipping Step 2 (discussion-mode signal check).** Triaging on un-sharpened entry-points produces low-quality verdicts.
7. **Asking the operator to confirm direct change / orphan slice / defer.** Decide and execute. The operator's attention is for genuinely high-blast-radius transitions, not routine routing.

## Checklist

- [ ] Loaded `drive/triage/README.md` (if exists)
- [ ] Checked discussion-mode signals; routed to `drive-discussion` first if any fired
- [ ] Ran `drive-triage-work`; got a verdict
- [ ] (Authorisation-required verdicts only) Confirmed with operator (interactive) or logged stop-condition (unattended)
- [ ] Executed the verdict's setup chain per § Workflow
- [ ] Updated Linear per the chosen pattern
- [ ] Handed off with a one-line summary

## Related skills

- `drive-triage-work` — runs the decision tree; this workflow calls it
- `drive-discussion` — fires when Step 2's signal check finds design ambiguity, surface uncertainty, or a parent-project assumption at risk
- `drive-build-workflow` — pilots the slice dispatch loop after this workflow routes to a slice
- `drive-deliver-workflow` — pilots the project lifecycle after this workflow routes to project / promote
- `drive-create-project`, `drive-specify-project`, `drive-specify-slice`, `drive-pr-description` — atomic skills called as setup steps
- `drive-bootstrap-context` — seeds `drive/<category>/README.md` if missing

## References

- [`docs/drive/design-decisions/2026-05-28-artefact-cascade-redesign.md`](../../docs/drive/design-decisions/2026-05-28-artefact-cascade-redesign.md) — the redesign that simplified verdicts to 3 delivery shapes + 4 transitions, made orphan-slice the default, and made operator confirmation conditional
- [`drive/triage/README.md`](../../drive/triage/README.md) — triage outputs, Linear-sync conventions, promotion/demotion patterns
- [`drive/plan/README.md`](../../drive/plan/README.md) — sizing discipline triage enforces
- [`drive/README.md`](../../drive/README.md) — protocol-as-memory; operators can run `drive-triage-work` manually instead of this workflow
