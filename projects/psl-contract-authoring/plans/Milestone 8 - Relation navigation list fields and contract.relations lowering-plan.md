# Milestone 8 — Relation navigation list fields and `contract.relations` lowering plan

## Summary

Expand the SQL PSL provider to accept **relation navigation list fields** (`Post[]` backrelations) while keeping **scalar lists** (`String[]`) as strict errors. In the same slice, emit deterministic top-level `**contract.relations`** metadata for both sides of each 1:N relation so ORM includes can resolve joins reliably and PSL-first parity matches TS-first emission.

**Spec:** `projects/psl-contract-authoring/specs/Milestone 8 - Relation navigation list fields and contract.relations lowering.spec.md`

## Collaborators


| Role         | Person/Team                                | Context                                                           |
| ------------ | ------------------------------------------ | ----------------------------------------------------------------- |
| Maker        | Contract authoring owner                   | Drives PSL interpreter + fixture work                             |
| Reviewer     | Framework/tooling reviewer (TBD)           | Reviews diagnostics + determinism + contract shape                |
| Collaborator | SQL contract authoring surface owner (TBD) | Confirms relation metadata shape and TS parity expectations       |
| Collaborator | ORM client owner (TBD)                     | Confirms include resolution expectations for `contract.relations` |


## Milestones

### Milestone 1: Parser and AST support for backrelation lists + relation naming

Ensure `@prisma-next/psl-parser` exposes enough structure to:

- distinguish list fields (`[]`) at the field level (already present as `field.list`),
- recognize when a list field targets a model type, and
- parse relation naming forms used to disambiguate multiple relations between the same models (`@relation("Name")` and/or `@relation(name: "Name")`) with spans.

**Tasks:**

- Confirm current parser output supports `@relation("Name")` and `@relation(name: "Name")`:
  - if unsupported, extend parsing so the interpreter can read:
    - positional string literal argument (`@relation("UserToPost")`)
    - named string literal argument (`@relation(name: "UserToPost")`)
  - preserve spans for diagnostics and keep parsing strict
- Add/extend parser unit coverage for:
  - list field targeting a model (`posts Post[]`)
  - scalar list field (`tags String[]`) (syntax-level)
  - relation naming on both FK-side and list-side fields

### Milestone 2: Interpreter changes (accept backrelation lists, reject scalar lists, emit `contract.relations`)

Teach `@prisma-next/sql-contract-psl` to:

- accept navigation-only relation lists when they can be matched to an FK-side relation, and
- emit deterministic `contract.relations` entries for both FK-side and backrelation fields.

**Tasks:**

- Update list-field handling:
  - keep strict errors for scalar/enum/named-type lists
  - accept list fields whose element type resolves to a model name
  - ensure accepted backrelation list fields do not map to storage columns or model fields
- Implement backrelation matching:
  - if a relation name is present on the list field, match only FK-side relations with the same name
  - otherwise require an unambiguous single FK-side candidate; error on none/ambiguous
  - add diagnostics for:
    - orphaned backrelation list (no candidate)
    - ambiguous match (multiple candidates)
- Emit relation metadata deterministically:
  - populate `contract.relations[declaringTable][relationFieldName]` for FK-side (`N:1`) relations
  - populate `contract.relations[parentTable][backrelationFieldName]` for list-side (`1:N`) relations
  - ensure `on.parentCols` / `on.childCols` orientation matches the spec (declaring model → related model)
  - ensure ordering is stable (sort by table name, then field name)
- Ensure TS parity behavior for relation metadata:
  - use **storage column names** in `on.parentCols` / `on.childCols` (the ORM include layer consumes them directly)
  - keep model-local `models.<Model>.relations` present (builder compatibility), but treat `contract.relations` as the canonical include metadata surface

### Milestone 3: Fixture-driven parity + diagnostics coverage + docs update

Add evidence that the new surface works and is stable.

**Tasks:**

- Add a parity fixture proving 1:N + backrelation list parity:
  - PSL schema contains both FK-side relation and backrelation list field (`User.posts Post[]` + `Post.user User @relation(fields:, references:)`)
  - TS fixture uses `.relation(...)` for both sides (or equivalent) and emits matching `contract.relations`
  - expected snapshot includes non-empty top-level `relations`
- Add diagnostics fixture coverage for:
  - scalar list field rejection (`String[]`)
  - orphaned backrelation list (no matching FK-side)
  - ambiguous backrelation match (multiple FK-side candidates), plus a resolution case using named relations
- Update docs where the PSL authoring surface is described to reflect:
  - backrelation list fields are supported when backed by an FK-side relation
  - scalar lists remain unsupported
  - many-to-many remains “explicit join model”

## Test Coverage


| Acceptance Criterion                                                 | Test Type   | Task/Milestone                    | Notes                                                                |
| -------------------------------------------------------------------- | ----------- | --------------------------------- | -------------------------------------------------------------------- |
| PSL schema with basic 1:N + backrelation list is accepted            | Integration | Milestone 3 / parity fixture      | Parity harness asserts canonical JSON + hashes                       |
| Scalar list fields still fail with strict, span-based diagnostic     | Integration | Milestone 3 / diagnostics fixture | Keep generic “unsupported feature” style diagnostic                  |
| `contract.relations` contains FK-side (`N:1`) metadata               | Integration | Milestone 2 + 3                   | Assert snapshot contains correct oriented join cols                  |
| `contract.relations` contains backrelation (`1:N`) metadata          | Integration | Milestone 2 + 3                   | Assert snapshot contains inverse oriented join cols                  |
| Parity fixture demonstrates canonical `contract.json` equality vs TS | Integration | Milestone 3 / parity fixture      | Harness already checks IR + JSON + hashes                            |
| Orphaned backrelation list fails with actionable message             | Integration | Milestone 3 / diagnostics fixture | Include hint to add FK-side relation / explicit join model           |
| Ambiguous backrelation match fails with actionable message           | Integration | Milestone 3 / diagnostics fixture | Include hint to use named relations                                  |
| Docs updated for supported relation surface + many-to-many guidance  | Docs        | Milestone 3 / docs task           | Keep docs consistent with `contract-psl` README and product PSL docs |


## Open Items

- Verify the exact TS authoring conventions for naming and emitting both sides of a 1:N relation in `contract.relations` so PSL-first parity aligns (field names, table naming, and join column orientation).
- Confirm where diagnostics fixtures for parity harness live for negative cases (reuse existing CLI/diagnostics harness vs extending parity harness to include expected failures).

