# drive/project — project-context for project-level workflows

Loaded by `drive-create-project`, `drive-close-project`, `drive-deliver-workflow`, and `drive-plan-project`. Holds prisma-next's project-level conventions, status-update cadence, slice-composition patterns, and close-out destinations.

> **Trial period in effect (ends 2026-06-02).** When any drive-* skill in this category produces a finding, record it in [`findings.md`](./findings.md). Quality bar, tags, and format live in [`docs/drive/trial.md`](../../docs/drive/trial.md).

## Linear conventions

- **Project creation.** Linear Projects are created via the `save_project` MCP tool.
- **Working-branch naming.** Project working branch is named with the Linear Project ID: `<tml-id>-<descriptive-slug>` (lowercased; hyphens). Example: `tml-2549-agile-agent-orchestration`.
- **Initial status update.** Links the project's spec.
- **State conventions.** Don't manually transition issues to a completed state; the GitHub integration handles it on PR merge (auto-transitions to the team's terminal state). Manual transitions before merge are fine (e.g. moving to `In review` when the PR opens).
- **Promotion / demotion.** Handled by `drive-triage-work`; see `drive/triage/README.md` for the ceremony.

## Status-update cadence

- Linear Project status: update at slice-merge (drive-deliver-workflow does this implicitly via `drive-check-health`).
- Wider-team comms: optional, operator-set. Use `drive-post-update` ([PR #93](https://github.com/prisma/ignite/pull/93)) for the cadence the project needs.
- Cross-team dependencies: surface in the project plan's `Dependencies` section; ping owners explicitly when a dependency is blocking.

## Project-DoR overlay

In addition to the canonical project DoR:

- [ ] Linear Project exists (created via `save_project` MCP tool).
- [ ] If started from a ticket: promotion pattern applied (ticket moved into Linear Project, marked Done, renamed `Plan: <project name>` — see promotion ceremony in `drive/triage/README.md`).
- [ ] Project working branch exists, named with Linear Project ID (e.g. `tml-2549-<descriptive-slug>`).
- [ ] `projects/<project>/` folder scaffolded with `spec.md` + `plan.md` placeholders; `README.md` present.

## Slice-composition patterns

Common shapes the team uses for project decomposition:

- **Sandwich pattern**: contract / IR layer first → emitter / consumer layer → adapter / target layer. Good for projects that introduce a new feature end-to-end.
- **Migration pattern**: feature flag / dual-write first → migrate consumers → remove old path. Almost always a project (multi-slice).
- **Refactor-with-call-site-migration**: refactor the source → migrate one consumer (the canary) → migrate the rest (parallel). The canary slice catches design issues before fan-out.

## ADR cadence

Projects that introduce durable architectural decisions (subsystems, patterns, conventions) write ADRs as part of close-out — `drive-close-project` migrates them into `docs/architecture docs/adrs/`. The mandatory-final retro is a natural surface for "did this project produce an ADR-worthy decision?"

## Close-out destinations

`drive-close-project` uses these defaults when migrating long-lived methodology out of `projects/<project>/`:

| Source pattern under `projects/<project>/` | Destination root |
| --- | --- |
| `principles/**.md` | `docs/<project>/principles/` |
| `model.md`, `vocabulary.md`, `glossary.md`, `domain-model.md` | `docs/<project>/` (top-level of project subtree) |
| `workflow.md`, `process.md` | `docs/<project>/` |
| `*-conventions.md`, `*-restructure.md` | `docs/<project>/` (rename `*-restructure.md` → `*-conventions.md` on the way in unless the operator overrides) |
| `adrs/**.md`, `decisions/**.md` | `docs/architecture docs/adrs/` (use the repo's ADR numbering — surface to operator before assigning) |

Index doc: `docs/<project>/README.md` (created at migration time).

Transient artefacts (deleted at close, never migrated): `spec.md`, `plan.md`, `problem-statement.md`, `design-decisions.md` (decisions that needed preservation should already be ADRs by close-out), `retros.md`, `calibration/**`, project-level `README.md`, `specs/`, `plans/`, `assets/` (unless explicitly tagged "keep").

Ambiguous-by-default: anything not matching the rules above. `drive-close-project` surfaces these to the operator at classification time — never silently classified.

## PDoD addendum: ADR audit

Final-retro item: walk `design-decisions.md` for any decision that hasn't migrated to an ADR. If unmigrated decisions exist that are architecturally durable (cross-cutting, hard to reverse, affect future work), block close-out until they have ADRs — closing with un-ADR'd architectural decisions is a known close-out failure mode.

## Project-DoD overlay

Beyond the canonical project DoD items:

### Repo-wide gates

- [ ] `pnpm lint:deps` clean.
- [ ] `pnpm build` clean (turbo cache OK).
- [ ] `pnpm fixtures:check` clean.
- [ ] If the project introduces a new package: `architecture.config.json` updated; `pnpm lint:deps` passes the new layering.
- [ ] If the project ships a feature that changes the demo or examples: demo runs end-to-end against the new feature.

### Documentation & migration

- [ ] Long-lived docs migrated to `docs/` (per the doc-maintenance rule); subsystem / patterns docs updated if the project affects them.
- [ ] Any new architecture docs are linked from `docs/architecture docs/`.
- [ ] References to `projects/<project>/**` removed from the codebase (per the doc-maintenance rule).
- [ ] `projects/<project>/` deleted from the repo.

### Linear close-out

- [ ] Linear Project marked Completed (or Cancelled with rationale in final status update).
- [ ] Original promoted ticket (if applicable) reflects project completion (comment or status update).
- [ ] Final status update on Linear Project links the close-out retro.

### Manual-QA roll-up

- [ ] Every slice that touched user-observable surface has a `drive-qa-plan` script + ≥1 `drive-qa-run` report; no unresolved 🛑 Blocker findings; `drive/qa/README.md` updated if the project surfaced new audiences or coverage-gate gaps.

_(Living; add overlays as the team discovers them.)_
