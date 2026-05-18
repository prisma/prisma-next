# drive/triage — project-context for triage

Loaded by `drive-triage-work` and `drive-start-workflow`. Holds prisma-next's accumulated triage protocol — failure modes, sizing anchors, ticket-shape patterns, Linear-sync conventions.

## Sizing anchors (calibration for this repo)

Reference tasks that calibrate "what's a direct change vs orphan slice vs in-project slice in prisma-next." Populated by retros + operator calibration; treat as living.

| Task | Verdict | Why |
|---|---|---|
| _e.g._ Typo fix in a markdown file under `docs/` | Direct change | One-file diff; obvious-from-reading; no downstream effect. |
| _e.g._ Add a new operation to an existing SQL operation family | Slice (in-project under an active SQL project; orphan otherwise) | Touches contract + emitter + tests + fixtures. Reviewable in one sitting but not 30-sec. |
| _e.g._ Introduce a new target pack | New project | Multi-layer; new contract surface; new fixtures; new tests; multiple PRs. |

_(Add anchors as the team accrues calibration via retros.)_

## Ticket-shape patterns

Patterns that have a known verdict in this repo:

| Pattern | Verdict | Notes |
|---|---|---|
| _e.g._ "Bump <dep> to <version>" with no breaking changes | Direct change | Lockfile + maybe one or two type fixes. |
| _e.g._ Bump that triggers a breaking change (typing, behaviour shift) | Slice | Needs migration. |
| _e.g._ "Add lint rule X" | Usually orphan slice | Rule + initial code-fix sweep. |

_(Add patterns as they emerge from operator experience.)_

## Linear-sync conventions

- Linear team: _<team-key>_ (to be filled in by operator)
- Linear project for orphan-slice "umbrella": _<project-key or note "none — orphan slices have no Linear Project">_
- Issue identifier prefix: _<e.g. TML->_
- Branch-name convention for issue link: _e.g. `tml-NNNN-short-slug`_
- PR-title convention: _e.g. include `(TML-NNNN)` or `Refs: TML-NNNN` to let GH integration auto-close on merge_

## Promote / demote ceremony notes

- **Promote**: when an in-flight slice grows past one PR.
  - Create a new Linear Project.
  - Move the original ticket into the Project; mark it Done; rename it `Plan: <project-slug>` (or comment-and-leave-name if rename is disruptive).
  - Scaffold `projects/<project>/` via `drive-create-project`.
  - Migrate the in-flight slice spec / draft to `projects/<project>/spec.md` as the starting point for `drive-project-specify`.
- **Demote**: when an in-flight project's remaining scope fits one PR.
  - Identify the surviving issue.
  - Close other open issues in the Linear Project with comments "merged into <surviving>".
  - Move the surviving issue out of the Linear Project (set `project = null`).
  - Mark the Linear Project Cancelled (if no slices shipped) or Completed (if at least one shipped).
  - Migrate useful content from `projects/<project>/` to the surviving PR body.
  - Delete `projects/<project>/`.

Both ceremonies require operator authorisation per `drive-triage-work`'s authorisation flag.

## Failure modes (catalogue; populated by retros)

_When triage misroutes work, the retro lands here. Each entry: pattern → consequence → mitigation._

_(Empty at seeding; populated by `drive-retro-run`.)_
