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

## Audit-class deliverables under `projects/**/reviews/`

The workspace `.gitignore` ignores `projects/**/reviews/` by default — review artefacts (`code-review.md`, `system-design-review.md`, `walkthrough.md`, reviewer scratchpads) are transient and local. Most projects keep them that way.

A few project DoDs require a specific audit-class artefact to land **in PR history** instead of just on disk: a PII-zero audit checklist for a telemetry project, a security-review sign-off for a credentials-handling project, a license-audit roll-up for an external-dep adoption project. Those need to be tracked, and a naive `!projects/<project>/reviews/<file>` re-include underneath the existing rule will *not* work — git stops descending into a wholly-ignored directory, so re-includes inside it never fire.

The fix is a two-line change to the workspace `.gitignore`:

1. Replace `projects/**/reviews/` (ignores the directory itself) with `projects/**/reviews/*` (ignores the directory's contents but leaves the directory traversable). This is a pure relaxation: every file under every project's reviews folder remains ignored unless explicitly re-included.
2. Add a narrow `!projects/<project>/reviews/<file>` re-include for each named artefact that needs PR-history persistence.

The re-included files survive close-out only if their tracked copy is migrated out of `projects/<project>/reviews/` before the project workspace is deleted. The default close-out posture is **delete** — audit artefacts establish that the audit happened in PR history but are not preserved as steady-state docs. If a particular artefact should outlive close-out (e.g. it documents a precedent that future projects will rely on), migrate it explicitly to `docs/<project>/` or to a sibling `docs/` location at close-out time.

Precedent: this pattern was first applied during the cli-telemetry project's close-out for its AC13 PII-zero audit checklist. The audit's existence as a record lives in PR history of the close-out commit; the gitignore exception line was removed when the project workspace was deleted, leaving only the relaxed parent rule as the steady-state pattern for future projects to extend.
