# drive/project — project-context for project-level workflows

Loaded by `drive-deliver-workflow` and `drive-plan-project`. Holds prisma-next's project-level conventions, status-update cadence, slice-composition patterns.

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

## Project-DoD overlays specific to prisma-next

Beyond the canonical DoD items, prisma-next projects must include:

- [ ] `pnpm lint:deps` clean.
- [ ] `pnpm build` clean (turbo cache OK).
- [ ] `pnpm fixtures:check` clean.
- [ ] If the project introduces a new package: `architecture.config.json` updated; `pnpm lint:deps` passes the new layering.
- [ ] If the project ships a feature that changes the demo or examples: demo runs end-to-end against the new feature.
- [ ] Long-lived docs land in `docs/` (per the canonical PDoD item); also: subsystem docs / patterns docs updated if the project affects them.

_(Living; add overlays as the team discovers them.)_
