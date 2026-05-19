# drive/project — project-context for project-level workflows

Loaded by `drive-create-project`, `drive-close-project`, `drive-deliver-workflow`, and `drive-plan-project`. Holds prisma-next's operational conventions for project-scope work — tracker integration, status-update cadence, slice-composition patterns, and close-out destinations.

> **Trial period in effect (ends 2026-06-02).** When any drive-* skill in this category produces a finding, record it in [`findings.md`](./findings.md). Quality bar, tags, and format live in [`drive/trial.md`](../trial.md).

## Calibration

Project-scope calibration lives in [`drive/calibration/`](../calibration/):

- [`drive/calibration/dor.md`](../calibration/dor.md) — project-DoR overlay (Linear Project, working branch, scaffold)
- [`drive/calibration/dod.md`](../calibration/dod.md) — project-DoD overlay (repo-wide gates, doc/migration, Linear close-out, manual-QA roll-up, ADR audit)
- [`drive/calibration/patterns.md § Slice-composition patterns`](../calibration/patterns.md#slice-composition-patterns) — sandwich / migration / canary patterns for project decomposition

## Linear conventions

- **Project creation.** Linear Projects are created via the `save_project` MCP tool.
- **Working-branch naming.** Project working branch is named with the Linear Project ID: `<tml-id>-<descriptive-slug>` (lowercased; hyphens). Example: `tml-2549-agile-agent-orchestration`.
- **Initial status update.** Links the project's spec.
- **State conventions.** Don't manually transition issues to a completed state; the GitHub integration handles it on PR merge (auto-transitions to the team's terminal state). Manual transitions before merge are fine (e.g. moving to `In review` when the PR opens).
- **Promotion / demotion.** Handled by `drive-triage-work`; see [`drive/triage/README.md`](../triage/README.md) for the ceremony.

## Status-update cadence

- Linear Project status: update at slice-merge (`drive-deliver-workflow` does this implicitly via `drive-check-health`).
- Wider-team comms: optional, operator-set. Use `drive-post-update` for the cadence the project needs.
- Cross-team dependencies: surface in the project plan's `Dependencies` section; ping owners explicitly when a dependency is blocking.

## ADR cadence

Projects that introduce durable architectural decisions (subsystems, patterns, conventions) write ADRs as part of close-out — `drive-close-project` migrates them into `docs/architecture docs/adrs/`. The mandatory-final retro is a natural surface for "did this project produce an ADR-worthy decision?"

## Close-out destinations

`drive-close-project` uses these defaults when migrating long-lived methodology out of `projects/<project>/`:

| Source pattern under `projects/<project>/` | Destination root |
| --- | --- |
| `principles/**.md` | `docs/<project>/principles/` |
| `model.md`, `vocabulary.md`, `glossary.md`, `domain-model.md` | `docs/<project>/` (top-level of project subtree) |
| `workflow.md`, `process.md` | `docs/<project>/` |
| `*-conventions.md` | `docs/<project>/` |
| `adrs/**.md`, `decisions/**.md` | `docs/architecture docs/adrs/` (use the repo's ADR numbering — surface to operator before assigning) |
| `calibration/**` | **Lift** into [`drive/calibration/`](../calibration/) (not migrated as docs). Same lift-then-delete pattern as worked-example pollution; see `drive-close-project` step 4.5. |

Index doc: `docs/<project>/README.md` (created at migration time).

Transient artefacts (deleted at close, never migrated): `spec.md`, `plan.md`, `problem-statement.md`, `*-restructure.md`, `migration-plan.md`, `design-decisions.md` (decisions that needed preservation should already be ADRs by close-out), `retros.md`, `trial.md`, project-level `README.md`, `specs/`, `plans/`, `assets/` (unless explicitly tagged "keep").

Ambiguous-by-default: anything not matching the rules above. `drive-close-project` surfaces these to the operator at classification time — never silently classified.
