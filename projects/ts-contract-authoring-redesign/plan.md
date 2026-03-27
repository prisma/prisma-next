# Refined Option A Execution Plan

## Summary

This project lands the refined Option A SQL contract authoring surface: `defineContract({ ... })` with `model('User', { fields, relations }).attributes(...).sql(...)`, inline `field.id()` / `field.unique()` for the 90% path, typed local field refs, typed model tokens for cross-model refs, and lowering to the existing canonical SQL contract IR. Success means authors can use the new staged model DSL without changing emitted contract semantics, downstream `schema()` / `sql()` inference keeps working, and the first slice establishes a path to migrate the remaining high-level field vocabulary and call sites.

**Spec:** `projects/ts-contract-authoring-redesign/spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Project owner | Drives the redesign and review direction |
| Reviewer | SQL authoring maintainer | Reviews public API shape, lowering, and type-level tradeoffs |
| Collaborator | Emitter / runtime maintainers | Validate parity assumptions and no-emit inference compatibility |

## Milestones

### Milestone 1: Authoring DSL and Lowering

Deliver the first coherent refined Option A slice on top of the current SQL builder/lowering pipeline.

**Tasks:**

- [ ] Add refined Option A public surface types and exports in `@prisma-next/sql-contract-ts`.
- [ ] Implement `defineContract({ ... })` object-literal entrypoint as an additive overload over the current builder.
- [ ] Implement `model('User', { fields, relations }).attributes(...).sql(...)` descriptors and lower them into the existing table/model builder path.
- [ ] Implement field, relation, and constraint helper vocabularies for the first slice.
- [ ] Implement root naming defaults plus per-table and per-field overrides.
- [ ] Preserve existing normalized contract output for supported refined Option A inputs.

### Milestone 2: Type Safety and Verification

Prove the new DSL is safe and usable through targeted runtime and type-level tests.

**Tasks:**

- [ ] Add unit tests for refined Option A lowering, constraint emission, and relation lowering.
- [ ] Add type tests proving `cols` includes scalar fields only and excludes relation fields.
- [ ] Add integration coverage showing a refined Option A contract works with `validateContract`, `schema()`, and `sql()`.
- [ ] Add parity-style tests comparing refined Option A output with equivalent legacy builder output.
- [ ] Add focused portability coverage for naming defaults and target swaps where feasible in-package.

### Milestone 3: Migration and Close-out

Prepare the repo to adopt the new surface and clean up transient project artifacts at project close-out.

**Tasks:**

- [ ] Update package docs and one representative example to the refined Option A surface.
- [ ] Decide which remaining high-level field helpers ship now versus follow-on slices and document any temporary gaps.
- [ ] Verify all acceptance criteria against implemented tests and any required manual checks.
- [ ] Finalize any long-lived docs or ADR updates needed outside `projects/`.
- [ ] Remove repo-wide references to `projects/ts-contract-authoring-redesign/**` during close-out and delete the transient project folder.

## Test Coverage

| Acceptance Criterion | Test Type | Task/Milestone | Notes |
|---|---|---|---|
| Author can define a model with `fields`, `relations`, `.attributes(...)`, and `.sql(...)` without separate `.table(...)` and `.model(...)` calls | Unit + Integration | Milestone 1 / Milestone 2 | Core refined Option A construction path |
| Common scalar fields no longer require duplicate field-to-column declarations when names match | Unit | Milestone 1 / Milestone 2 | Cover default column naming |
| Table and column naming come from root strategy with explicit overrides | Unit | Milestone 1 / Milestone 2 | Cover `snake_case` and explicit `table` / `column` overrides |
| `cols` exposes only scalar fields and excludes relations | Type test | Milestone 2 | Primary DX acceptance point |
| Named IDs, uniques, indexes, and FKs are supported, including compound constraints | Unit | Milestone 1 / Milestone 2 | Cover inline `field.id()` / `field.unique()`, compound `.attributes(...)`, and `constraints.index(...)` / `constraints.foreignKey(...)` |
| Defaults, generated values, and named storage types work without changing emitted contract structure | Unit + Parity | Milestone 1 / Milestone 2 | Compare against legacy builder output where practical |
| Reverse/query-surface relations remain explicit while owning-side FK/storage authorship stays singular | Unit | Milestone 1 / Milestone 2 | Cover `belongsTo` + reverse relation shape |
| Representative Postgres contract can switch to SQLite with minimal change | Manual + Unit | Milestone 2 | First slice may verify structurally; broader portability can expand later |
| Downstream `schema()` / `sql()` inference continues to work | Integration + Type test | Milestone 2 | Must validate no-emit path |
| Lowering pipeline can later derive model/client helper types from the same authored contract | Manual design verification | Milestone 3 | Not fully implemented in first slice; verify architecture supports it |

## Open Items

- The first slice may not ship the full aspirational helper vocabulary from the spec; any omitted helpers need to be documented explicitly as follow-on work rather than left ambiguous.
- Relation definitions still use string model and field names; only foreign-key targets currently benefit from typed model tokens.
- The explain/debug surface is intentionally deferred, but the implementation should avoid boxing itself into a shape that makes it hard to add later.
