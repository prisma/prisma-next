# Drive: project-context memory for prisma-next

This directory is **prisma-next's home for project-context Drive memory** — the team's accumulated lessons, calibrations, and conventions overlaid onto the canonical Drive skill bodies.

Per [`projects/drive-domain-model/principles/protocol-as-memory.md`](../projects/drive-domain-model/principles/protocol-as-memory.md), the methodology has two memory homes:

- **Canonical skill bodies** (in `.agents/skills/drive-*/SKILL.md`, eventually pulled from upstream `prisma/ignite`). Portable methodology — the protocol every team adopts.
- **Project-context READMEs** (here, under `drive/<category>/README.md`). Team-specific protocol — the lessons, the calibrations, the failure-mode catalogues that don't generalise across teams.

Both are loaded by drive-* skills at workflow entry. Both are human-readable and human-runnable (per [`gradual-ai-adoption.md`](../projects/drive-domain-model/principles/gradual-ai-adoption.md)). A team member who hasn't invoked a single drive-* skill can read these directly to consult the team's protocol.

## Categories

| Category | Loaded by | Holds |
|---|---|---|
| [`triage/`](triage/README.md) | `drive-triage-work`, `drive-start-workflow` | Sizing anchors, ticket-shape patterns, calibration for "direct change vs slice in this repo," Linear-sync conventions |
| [`spec/`](spec/README.md) | `drive-project-specify`, `drive-slice-specify` | Required sections beyond template, common scope traps, edge-case patterns specific to prisma-next |
| [`plan/`](plan/README.md) | `drive-project-plan`, `drive-slice-plan` | Dispatch-sizing reference cases, per-dispatch DoR overlays, failure-mode catalogue, parallelisation heuristics |
| [`project/`](project/README.md) | `drive-deliver-workflow`, `drive-project-plan` | Project-level conventions, status-update cadence, slice-composition patterns |
| [`retro/`](retro/README.md) | `drive-retro-run` | Team-specific retro prompts, landing-surface preferences, common patterns |
| [`health/`](health/README.md) | `drive-health-check`, `drive-deliver-workflow` | Drift-signal thresholds, pick-next heuristics, throughput baselines, common false-positives |
| [`pr/`](pr/README.md) | `drive-pr-description`, `drive-pr-walkthrough` | PR-body conventions, scope-statement patterns, commit-style rules |

## Reconciliation loop

Lessons accumulate here from `drive-retro-run` invocations. When a lesson generalises across teams, it gets promoted to canonical via `drive-update-skills` ([PR #93](https://github.com/prisma/ignite/pull/93)). When a canonical body changes upstream, `drive-reconcile-skills` flags overlays that may now be redundant or contradictory.

The split between canonical (portable) and project-context (team-specific) is the load-bearing architecture per [`protocol-as-memory.md`](../projects/drive-domain-model/principles/protocol-as-memory.md). Don't move team-specific things into canonical; don't keep cross-team things only in project-context.

## Status: seeded scaffolds

These READMEs were initially seeded as part of the agile-agent-orchestration project shaping. They start mostly empty — entries land here as the team uses Drive on real projects and `drive-retro-run` produces lessons. A README that stays empty after a few months of use is a signal that the category either isn't relevant for this team yet OR that retros aren't firing on patterns in that category.
