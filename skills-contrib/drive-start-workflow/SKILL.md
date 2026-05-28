---
name: drive-start-workflow
description: >
  Workflow skill. Pilots triage + the verdict's setup chain. Routes incoming
  work (direct change / slice / project / promote / demote / spike / defer) and
  executes the immediate downstream setup. Use at every fresh entry into Drive
  (Linear ticket, bug report, customer ask, "I should do X") AND mid-flight
  when scope shifts. Decides and executes by default; confirms with the
  operator only for promote / demote / project verdicts where the spec sketch
  diverges from the ticket scope.
metadata:
  version: "2026.5.28"
---

> **Execution mode: orchestrator-direct.** This workflow skill puts you in the
> Orchestrator role (see [`drive/roles/README.md`](../../drive/roles/README.md)).
> Your verbs: **delegate**, **synthesize**, **coordinate**, **decide**, and
> **author** project / slice artifacts directly.
>
> **File-path boundary:** your file writes only land inside
> `projects/<current-project>/`. Writing elsewhere is the signal to **delegate**.
> Reads outside the project directory are fine; writes are not.
>
> **Stop-and-delegate triggers:** if you are about to call `Read` / `Grep` /
> `Glob` on source code, `Shell` for build/test/lint, or `Write` / `StrReplace`
> on a file outside `projects/<current-project>/` — **STOP. Dispatch.** Escape
> hatch (rare, brief, navigational): single-tool-call coordination acts are
> fine. Log the use.

# Drive: Start Workflow

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
   direct        slice          project           promote /  spike   defer
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
                             workflow                     artifact
```

## Workflow

### Step 1 — Load context

Read `drive/triage/README.md` if it exists. The team's accumulated triage protocol — failure modes hit, sizing heuristics, ticket-shape patterns, calibration for *"what's a direct change here vs an orphan slice."*

### Step 2 — Check discussion-mode signals; route if any fire

Before triage, scan the entry-point for the signals listed in `drive-triage-work` § Step 2: design ambiguity in the ticket, surface uncertainty (first-grep returns more files than expected; unfamiliar area), parent-project assumption at risk.

If any signal fires → route to `drive-discussion` first; the discussion may sharpen the entry-point before triage runs.

### Step 3 — Run triage

Invoke `drive-triage-work` with the (possibly discussion-sharpened) entry-point. Receive one verdict.

### Step 4 — Decide and execute (default); confirm only when authorisation required

**Decide and execute by default.** For direct change / slice / spike / defer verdicts (and project verdicts where the spec sketch matches the ticket scope), proceed to Step 5 without operator confirmation. Log the verdict + one-line rationale in the chat output so the operator sees what was decided.

**Confirm with operator for:**

- **Promote / demote** — Linear side-effects are visible to the wider team.
- **Project** when the orchestrator's spec sketch suggests significantly more work than the ticket text implied — operator may want to re-scope, defer parts, or split.

In interactive mode: present the verdict + setup chain; wait for confirmation. In unattended mode: log a stop-condition under `wip/unattended-decisions.md` and emit a notification surface for the operator to pick up on return.

### Step 5 — Execute the verdict's setup chain

#### Direct change

1. `drive-pr-description` (direct-change framing): intent statement, Linear ticket link, scope statement, brief verification note (*"reviewer can verify in ~30 sec by reading the diff"*).
2. **Sanity-check the verdict** at PR-description time — if the diff is sprawling, the 30-second-verifiable claim was wrong; escalate back to `drive-triage-work` for re-routing. Direct change is a scope claim; the diff is the test.
3. Dispatch an Implementer (branch from `main`, edit, commit, `gh pr create`). Return when the PR is open.

#### Slice (orphan or in-project)

1. Determine sub-mode: **orphan** (default) or **in-project** (iff a parent `projects/<project>/` exists for this purpose AND the slice's spec relies on the project context).
2. `drive-specify-slice` (mode per sub-decision): inline in PR description (orphan) or at `projects/<project>/slices/<slice>/spec.md` (in-project).
3. Return — caller invokes `drive-build-workflow` next.

#### Project

1. `drive-create-project`: scaffold `projects/<project>/`. Project DoR check fires.
2. `drive-specify-project`: project spec (often with design-discussion participation via `drive-discussion`).
3. Return — caller invokes `drive-plan-project` and then `drive-deliver-workflow`.

#### Promote (mid-flight: slice → project)

1. Create Linear Project (MCP: `linear.create_project` or equivalent).
2. Move the original Linear issue into the new Project; mark it Done; rename it `Plan: <project-slug>` (or post a comment if rename is disruptive).
3. `drive-create-project` with the new slug; scaffold `projects/<project>/`.
4. Migrate the in-flight slice spec / draft into `projects/<project>/spec.md` (rough first draft; refine via `drive-specify-project`).
5. Return — caller invokes `drive-plan-project` → `drive-deliver-workflow`.

See `model.md § Tracker sync § Promotion pattern` for the canonical tool-call sequence.

#### Demote (mid-flight: project → slice / direct change)

1. Identify the surviving Linear issue (the one that still represents real work).
2. For each other open Linear issue in the Project: close with comment *"merged into &lt;surviving&gt;"*.
3. Move the surviving issue out of the Linear Project (`project = null`).
4. Mark the Linear Project Cancelled (no slices shipped) or Completed (at least one shipped).
5. **Migrate useful on-disk content** from `projects/<project>/` into the surviving PR description (slice plan summary, edge cases, learnings) before deletion.
6. Delete `projects/<project>/`.
7. Re-route the surviving work via `drive-start-workflow` — it becomes an orphan slice or direct change.

See `model.md § Tracker sync § Demotion pattern`.

#### Spike

1. `drive-build-workflow` with a spike-flavoured brief: single dispatch; DoD = *"the artifact answers the planning question"* not *"code is committed"*; artifact under `projects/<project>/spikes/<date>-<question>.md` (in-project) or `wip/spikes/...` (orphan).
2. On artifact emission: re-route via `drive-start-workflow` — the artifact carries enough information to triage the actual work to its right shape.

#### Defer

1. In a project → append to `projects/<project>/deferred.md` (create if missing) with title + rationale + originating context.
2. Orphan → write to operator scratch (`wip/deferred.md` or similar).

### Step 6 — Update Linear

Per the chosen verdict, transition issue / project state per the patterns above. Use Linear MCP tools, not direct API calls.

### Step 7 — Hand off

Return control with a one-line summary of what was routed where and what the next step is.

## Unattended mode

- **Promote, demote, and operator-flagged Project verdicts** require operator authorisation. In unattended mode: log a stop-condition under `wip/unattended-decisions.md` and emit a notification surface for the operator to pick up on return.
- Direct change / slice / spike / defer / Project (non-flagged) can proceed; log the verdict + reasoning to `wip/unattended-decisions.md`.

## Pitfalls

1. **Triage answers "looks like a direct change" but the change isn't 30-second-verifiable.** The verdict needs a sanity check at PR-description time — if the diff is sprawling, escalate back to triage for re-routing. Direct change is a *scope* claim; the diff is the test.
2. **Promotion ceremony executed without operator authorisation.** Linear side-effects are visible to the wider team. Always confirm in interactive mode; always log + halt in unattended mode.
3. **Demotion that deletes `projects/<x>/` without migrating useful content.** The slice plan, edge cases, and learnings may still apply to the surviving work. Migrate them to the surviving PR body before deletion.
4. **Re-triage that fires on every entry to the project loop.** Triage is for entry + scope-shift, not for double-checking. Repeated triage without a scope-shift signal is a workflow bug.
5. **Spike verdict that proceeds straight into implementation rather than into a spike dispatch.** The spike's DoD is "the artifact answers the question," not "code committed." The artifact triggers re-triage.
6. **Skipping Step 2 (discussion-mode signal check).** Triaging on un-sharpened entry-points produces low-quality verdicts.
7. **Asking the operator to confirm direct change / orphan slice / defer.** Decide and execute. The operator's attention is for genuinely high-blast-radius transitions, not routine routing.

## References

- [`drive/triage/README.md`](../../drive/triage/README.md) — triage outputs, Linear-sync conventions, promotion/demotion patterns.
- [`docs/drive/model.md`](../../docs/drive/model.md) § Tracker sync — promotion / demotion canonical tool-call sequences.
- [`drive/README.md`](../../drive/README.md) — protocol-as-memory; operators can run `drive-triage-work` manually instead of this workflow.
- `skills-contrib/drive-triage-work/`, `drive-discussion/`, `drive-create-project/`, `drive-specify-project/`, `drive-specify-slice/`, `drive-pr-description/`, `drive-build-workflow/`, `drive-deliver-workflow/` — the skills this workflow conducts.
