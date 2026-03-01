# Summary

Add PSL support for the **TS-aligned default function vocabulary** (primarily ID-related) and prove parity via fixture-driven conformance cases.

# Description

The TS authoring surface can express a broader set of default functions/expressions than PSL currently supports. Milestone 5 closes the most visible gap: ID/default functions used in typical application schemas (uuid/cuid/ulid/nanoid/dbgenerated), while staying within the existing contract model and avoiding connector-specific Prisma ORM semantics.

# Requirements

## Functional Requirements

- Support TS-aligned default function vocabulary (where TS authoring already emits it), including:
  - `uuid()`
  - `cuid()`
  - `ulid()`
  - `nanoid()`
  - `dbgenerated("...")`
- Add fixture-driven parity cases for each supported function, asserting canonical `contract.json` + stable hash equality vs TS fixtures.

## Non-Functional Requirements

- Strictly reject defaults that are not representable in the existing TS authoring surface/contract model.
- Avoid connector-specific expansions (keep aligned to TS parity).

## Non-goals

- Mongo-only ID semantics (e.g. `@db.ObjectId` + `auto()`).
- Feature work unrelated to defaults (belongs in other milestones).

# Acceptance Criteria

- [ ] Each supported default function has at least one parity fixture (PSL + TS + expected snapshot).
- [ ] Canonical `contract.json` + stable hash parity holds for each fixture.
- [ ] Unsupported defaults fail with actionable diagnostics.

# References

- Project spec: `projects/psl-contract-authoring/spec.md`
- Project plan: `projects/psl-contract-authoring/plans/plan.md`
- Gap inventory: `projects/psl-contract-authoring/references/authoring-surface-gap-inventory.md`

