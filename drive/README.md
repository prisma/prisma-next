# Drive: project-context memory for prisma-next

This directory is **prisma-next's home for project-context Drive memory** — the team's accumulated lessons, calibrations, and conventions overlaid onto the canonical Drive skill bodies.

Per the **protocol-as-memory** architecture (canonical skill bodies vs project-context READMEs under `drive/<category>/`, documented in this directory), the methodology has two memory homes:

- **Canonical skill bodies** (in `.agents/skills/drive-*/SKILL.md`, eventually pulled from upstream `prisma/ignite`). Portable methodology — the protocol every team adopts.
- **Project-context READMEs** (here, under `drive/<category>/README.md`). Team-specific protocol — the lessons, the calibrations, the failure-mode catalogues that don't generalise across teams.

Both are loaded by drive-* skills at workflow entry. Both are human-readable and human-runnable (workflow vs atomic skill tiers — operators can run steps manually without invoking skills). A team member who hasn't invoked a single drive-* skill can read these directly to consult the team's protocol.

## Categories

| Category | Loaded by | Holds |
|---|---|---|
| [`triage/`](triage/README.md) | `drive-triage-work`, `drive-start-workflow` | Sizing anchors, ticket-shape patterns, calibration for "direct change vs slice in this repo," Linear-sync conventions, promote / demote ceremony |
| [`spec/`](spec/README.md) | `drive-specify-project`, `drive-specify-slice` | Required sections beyond template, common scope traps, edge-case patterns, slice-DoR overlay, slice-DoD spec-side items |
| [`plan/`](plan/README.md) | `drive-plan-project`, `drive-plan-slice`, `drive-build-workflow` | Dispatch-sizing reference anchors (XS/S/M/L/XL), DoR / DoD overlays (dispatch-level), failure-mode catalogue, grep library, model-tier routing, parallelisation heuristics |
| [`project/`](project/README.md) | `drive-create-project`, `drive-close-project`, `drive-deliver-workflow`, `drive-plan-project` | Linear conventions, status-update cadence, slice-composition patterns, project-DoR / project-DoD overlays, close-out destinations |
| [`pr/`](pr/README.md) | `drive-pr-description`, `drive-pr-walkthrough` | PR-title / body conventions, walkthrough conventions, Linear-issue conventions, Linear state conventions, slice-DoD PR-side items, commit-style rules |
| [`qa/`](qa/README.md) | `drive-qa-plan`, `drive-qa-run` | Consumer audiences (extension authors / end users), substrate locations, coverage-gate gaps, slice-DoD QA-side items |
| [`retro/`](retro/README.md) | `drive-run-retro` | Team-specific retro prompts, landing-surface preferences, common patterns |
| [`health/`](health/README.md) | `drive-check-health`, `drive-deliver-workflow` | Drift-signal thresholds, pick-next heuristics, throughput baselines, common false-positives |

## Reconciliation loop

Lessons accumulate here from `drive-run-retro` invocations. When a lesson generalises across teams, it gets promoted to canonical via `drive-update-skills` ([PR #93](https://github.com/prisma/ignite/pull/93)). When a canonical body changes upstream, `drive-reconcile-skills` flags overlays that may now be redundant or contradictory.

The split between canonical (portable) and project-context (team-specific) is the load-bearing protocol-as-memory architecture. Don't move team-specific things into canonical; don't keep cross-team things only in project-context.

## Status: seeded scaffolds

These READMEs were initially seeded as part of the agile-agent-orchestration project shaping. They start mostly empty — entries land here as the team uses Drive on real projects and `drive-run-retro` produces lessons. A README that stays empty after a few months of use is a signal that the category either isn't relevant for this team yet OR that retros aren't firing on patterns in that category.
