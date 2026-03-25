# Summary

Add **parameterized attribute** support in PSL interpretation, with a minimum implementation that proves **pgvector vector column typing parity** with the existing TS authoring surface.

# Description

PSL encodes type parameters and extension metadata via attributes. Milestone 4 extends PSL parsing/interpretation so we can represent TS-authored `typeParams` / extension-pack metadata from PSL using the same canonical contract model, without introducing new primitives.

This is the first “new behavior” milestone after the fixture-driven harness: we ship one tight, parity-backed increment (pgvector), then expand within the same thematic area to other parameterized native types.

# Requirements

## Functional Requirements

- Support **parameterized attributes** in PSL interpretation on:
  - fields, and
  - named type instances in `types { ... }` (preferred ergonomic pattern)
- Support mapping/naming attributes:
  - `@@map("...")` for models
  - `@map("...")` for fields
- Prove extension-pack parity (minimum: pgvector):
  - Add at least one parity fixture asserting canonical `contract.json` + stable hash equality between:
    - PSL: `@pgvector.column(length: 1536)` (prefer via `types { ... }`)
    - TS: pgvector `vector(1536)` / `vectorColumn` through pack composition in config
- Enforce the composition constraint:
  - packs/namespaces are composed via `prisma-next.config.ts`
  - PSL does not activate or pin packs; using a namespace without composing the pack fails with a clear error

## Non-Functional Requirements

- Keep the IR boundary stable: parameterized attributes must map onto **existing TS-authoring-representable** contract shapes.
- Strictness: unsupported parameterized attributes are strict errors (no best-effort / no ignored metadata).

## Non-goals

- Full namespaced attribute surface for all packs (beyond what’s needed for the initial pgvector conformance case).
- Prisma ORM connector-specific semantics that exceed the TS authoring surface.

# Acceptance Criteria

- [ ] PSL can express parameterized attributes on fields and on `types { ... }` entries.
- [ ] `@map` / `@@map` are supported and participate in parity tests.
- [ ] At least one pgvector parity fixture exists and passes (canonical JSON + stable hashes).
- [ ] Using `@pgvector.*` without composing the pack via config fails with an actionable diagnostic.

# Open Questions

- Define the precise mapping for `types { ... }` entries (including extension-pack attributes like `@pgvector.column(length: 1536)`) to `codecId` / `nativeType` / `typeParams` so it matches the existing SQL TS authoring surface.

# References

- Project spec: `projects/psl-contract-authoring/spec.md`
- Project plan: `projects/psl-contract-authoring/plan.md`
- ADR 104: `docs/architecture docs/adrs/ADR 104 - PSL extension namespacing & syntax.md`
- Gap inventory: `projects/psl-contract-authoring/references/authoring-surface-gap-inventory.md`

