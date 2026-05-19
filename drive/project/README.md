# drive/project — project-context for project-level workflows

Loaded by `drive-create-project`, `drive-close-project`, `drive-deliver-workflow`, and `drive-plan-project`. Holds prisma-next's project-level conventions, status-update cadence, slice-composition patterns, and close-out destinations.

> **Trial period in effect (ends 2026-06-02).** When any drive-* skill in this category produces a finding, record it in [`findings.md`](./findings.md) per the quality bar at the top of that file. See [`docs/drive/learnings/README.md`](../../docs/drive/learnings/README.md) for the trial framing and synthesis ticket.

## Status-update cadence

- Linear Project status: update at slice-merge (drive-deliver-workflow does this implicitly via `drive-check-health`).
- Wider-team comms: optional, operator-set. Use `drive-post-update` ([PR #93](https://github.com/prisma/ignite/pull/93)) for the cadence the project needs.
- Cross-team dependencies: surface in the project plan's `Dependencies` section; ping owners explicitly when a dependency is blocking.

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

## Project-DoD overlays specific to prisma-next

Beyond the canonical DoD items, prisma-next projects must include:

- [ ] `pnpm lint:deps` clean.
- [ ] `pnpm build` clean (turbo cache OK).
- [ ] `pnpm fixtures:check` clean.
- [ ] If the project introduces a new package: `architecture.config.json` updated; `pnpm lint:deps` passes the new layering.
- [ ] If the project ships a feature that changes the demo or examples: demo runs end-to-end against the new feature.
- [ ] Long-lived docs land in `docs/` (per the canonical PDoD item); also: subsystem docs / patterns docs updated if the project affects them.

_(Living; add overlays as the team discovers them.)_
