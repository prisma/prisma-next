# <project-name>

## Purpose

_≤ 3 sentences. Immutable after the first dispatch starts (invariant I7). The minimum that captures **why this project exists**. Test: if this changed, the project's identity would change. Capture the **why**, not the **what** — "Give operators a self-service path to extract production data without DBA involvement," not "Build a CLI to export Postgres to S3."_

## At a glance

_A tight, concrete section anchoring the reader. Prose, code sample, Mermaid diagram, before/after worked example — whichever makes the design tangible. The reader answers two questions on a single skim: **what is happening** and **why should I care**. Don't flatten into a fact sheet._

## Non-goals

_Explicit list of what this project deliberately does NOT do. Scope-protection — what makes scope-shift visible per invariant I2. Examples: phase-2 items, adjacent surfaces left alone, scope other projects own._

## Place in the larger world

_External systems, libraries, sibling projects this project integrates with or depends on. Architectural fit. Integration / API contracts. References to ADRs that constrain the project's shape._

## Cross-cutting requirements

_Capabilities or constraints no single slice carries on its own. Examples: "every merged slice leaves the system deployable", "the new feature is reachable end-to-end via the documented CLI", "instrumentation continues to satisfy ADR-XX's tracing contract throughout"._

## Transitional-shape constraints

_Constraints on intermediate states between slices. Examples: "no breaking change without a deprecation window of at least one minor release", "every slice keeps CI green on `main`", "no `main` branch outage longer than 30 minutes during the migration"._

_If the project has no transitional-shape constraints (e.g. single-slice projects), say "N/A — single-slice project" and move on._

## Project Definition of Done

_Verifiable, binary conditions for closing this project. Inherit the team's DoD floor (this repo: [`drive/calibration/dod.md`](../../../drive/calibration/dod.md)) — do NOT restate it; add project-specific conditions on top. Each condition observable._

- [ ] Team-DoD floor items (inherited; see team-DoD doc for the canonical list).
- [ ] _Project-specific condition 1._
- [ ] _Project-specific condition 2._

## Open Questions

_Residual design-level questions the project ships with as known-unresolved. Each with a working position so the operator can confirm or override. Questions whose answers would change Purpose belong in design discussion, not here._

1. _Question._ Working position: _..._

## References

- Linear Project: _link_
- Sibling / dependent projects: _..._
- ADRs: _..._
- Design-discussion records: _..._
