# Summary

Build a **fixture-driven TS↔PSL parity harness** and expand fixtures across the **already-supported PSL surface**, without adding new PSL interpretation behavior yet.

# Description

Milestone 3 is intentionally “harness-first”: it turns the existing supported PSL surface into a **conformance suite** that can be extended over time by adding fixture directories on disk.

The harness must compare:

- the **normalized Contract IR** (primary debugging boundary), and
- the emitted canonical `contract.json` (and stable hashes).

This milestone also records (and keeps current) an explicit inventory of TS-authoring behaviors that PSL cannot yet express, to guide Milestones 4–5.

# Requirements

## Functional Requirements

- Build a parity harness that is **fixture-driven (data-driven)**: adding a new case is adding a new fixture directory (no per-case test code).
- Each fixture case includes:
  - PSL schema input (`schema.prisma` or `schema.psl`)
  - TS authoring input (`contract.ts`)
  - pack composition shared by both (`packs.ts`) so extension namespaces are **config-owned**
  - expected canonical snapshot (`expected.contract.json`)
- The harness runs both inputs through their respective authoring pipelines (PSL provider vs TS provider) and asserts parity at:
  - normalized Contract IR boundary
  - emitted canonical `contract.json` boundary
  - stable hashes for equivalent intent
- Add determinism coverage:
  - emit twice with unchanged inputs yields equivalent artifacts (canonical JSON equality)
- Add diagnostics coverage:
  - invalid/unsupported PSL yields actionable, span-based diagnostics surfaced through the CLI
- Record and maintain the TS surface gap inventory:
  - `projects/psl-contract-authoring/references/authoring-surface-gap-inventory.md`

## Non-Functional Requirements

- Prioritize debuggability: parity failures should surface as IR diffs first, then JSON diffs, then expected snapshot diffs.
- No new interpretation behavior in this milestone: fixtures cover what PSL already supports.

## Non-goals

- Parameterized attributes (belongs to Milestone 4).
- Pgvector parity (belongs to Milestone 4).
- ID default function vocabulary expansion (belongs to Milestone 5).

# Acceptance Criteria

- [ ] Fixture-driven parity harness exists (directory-per-case).
- [ ] Each case includes PSL + TS + packs + expected snapshot on disk.
- [ ] Parity assertions cover normalized IR, canonical JSON, and stable hashes.
- [ ] Determinism tests exist (emit twice == same artifacts).
- [ ] Diagnostics tests exist (span-based, actionable errors).
- [ ] Gap inventory is linked and kept current.

# References

- Project spec: `projects/psl-contract-authoring/spec.md`
- Project plan: `projects/psl-contract-authoring/plans/plan.md`
- Gap inventory: `projects/psl-contract-authoring/references/authoring-surface-gap-inventory.md`

