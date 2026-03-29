# Mongo ORM PoC Plan

## Summary

Implement the contract redesign (ADRs 1-3) and build a minimal read-only Mongo ORM client that proves the domain/storage separation works end-to-end. Success: a `findMany` with `include` on a polymorphic collection with both embedded and referenced relations returns correctly-typed results, and the same domain model compiles as both a Mongo and SQL contract.

**Spec:** `projects/mongo-orm-poc/spec.md`
**Linear:** [Mongo PoC](https://linear.app/prisma-company/project/mongo-poc-89d4dcdbcd9a) — keep Linear in sync as tasks progress, scope changes, or milestones complete.

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Will Madden | Drives execution |

## Milestones

### Milestone 1: Redesigned contract types and test schema

Restructure `MongoContract` to follow the ADRs and hand-craft contract artifacts for the test schema. This milestone produces the contract that everything else builds on.

**Test schema**: Task (polymorphic: Bug/Feature, discriminated by `type`) → User (referenced, N:1 via `assigneeId`). User has embedded Addresses (value-type embed, 1:N). Task has embedded Comments (entity embed with `_id`, 1:N).

**Tasks:**

- [ ] **Design relation storage details** — resolve the open question: what fields do `"reference"` and `"embed"` relations carry? Settle on a shape (e.g. `"reference"` → `{ fields: ["assigneeId"] }`, `"embed"` → `{ field: "comments" }`) and document it.
- [ ] **Restructure `MongoContract` types** — update the TypeScript types to follow ADRs 1-3: add `roots`, change `model.fields` to string arrays, restructure `model.storage` as the bridge (collection + field-to-codec mappings), add `discriminator` + `variants`, add relation `strategy`.
- [ ] **Hand-craft `contract.d.ts`** for the test schema — Task (with discriminator/variants), Bug, Feature, User, Address (value type), Comment (embedded entity). Variant types express the full merged shape (base + own fields).
- [ ] **Hand-craft `contract.json`** matching the `.d.ts` types.
- [ ] **Update existing M1/M2 tests** to work with the restructured contract (or create a parallel contract fixture for the new structure).
- [ ] **Type-level test: contract structure** — verify that the contract types compile and that `roots`, `models`, `discriminator`, `variants`, and relation strategies are all present and correctly typed.

### Milestone 2: Minimal ORM client with findMany and include

Build the ORM client that consumes the contract. Scoped to reads: root-based accessors, `findMany` with basic equality filters, `include` for both referenced and embedded relations, and polymorphic type narrowing.

**Tasks:**

- [ ] **Implement root-based accessor factory** — given a contract's `roots` section, produce an object with a property for each root (e.g. `db.tasks`, `db.users`). Each root provides a `findMany` method.
- [ ] **Implement `findMany` with row type inference** — `findMany` on a root returns `AsyncIterableResult<Row>` where `Row` is inferred from the contract's model definition and codec types. No manual type annotation by the caller.
- [ ] **Implement basic equality filters** — `findMany({ where: { email: 'alice@example.com' } })` compiles to a Mongo filter document. Filter keys are constrained to the model's field names. Uses structured objects consistent with the SQL ORM's interface.
- [ ] **Implement `include` for referenced relations** — `findMany({ include: { assignee: true } })` resolves the referenced User via `$lookup` or a follow-up query, returning the related document nested in the result. The relation's strategy and field info from the contract drive the query construction.
- [ ] **Implement `include` for embedded relations** — `findMany({ include: { comments: true } })` returns embedded documents as part of the parent result. Since embedded documents are stored in the parent document, this is primarily a type-level concern (projecting the correct shape) rather than an additional query.
- [ ] **Implement polymorphic query return types** — querying `db.tasks.findMany()` returns a discriminated union type (`Task | Bug | Feature`). The discriminator field (`type`) enables runtime narrowing. The ORM reads `discriminator` + `variants` from the contract to construct the union type.
- [ ] **Integration tests: full flow** — tests against `mongodb-memory-server` exercising:
  - `findMany` on a non-polymorphic root (`db.users`) returns typed results
  - `findMany` with equality filter narrows results correctly
  - `include` on a referenced relation (`tasks.include.assignee`) returns related documents
  - `include` on an embedded relation (`users.include.addresses` or `tasks.include.comments`) returns embedded documents
  - `findMany` on a polymorphic root (`db.tasks`) returns a discriminated union
  - Discriminator-based narrowing works at the type level (compile-time) and at runtime (filtering by `type: 'bug'` returns only Bug-shaped results)

### Milestone 3: Cross-family contract symmetry

Prove that the domain level of the contract is family-agnostic by hand-crafting the same schema as both a Mongo and SQL contract.

**Tasks:**

- [ ] **Hand-craft SQL `contract.d.ts`** for the same domain model (Task/Bug/Feature/User/Address/Comment) using the redesigned structure with SQL-specific `model.storage` (field → column mappings) and `storage.tables`.
- [ ] **Type-level test: domain symmetry** — a TypeScript file that imports both the Mongo and SQL contracts and statically verifies that `roots`, `models` (with `fields`, `discriminator`, `variants`), and `relations` are structurally identical. Only `model.storage` and top-level `storage` differ.
- [ ] **Document convergence/divergence** — update [contract-symmetry.md](../../docs/planning/mongo-target/1-design-docs/contract-symmetry.md) with concrete findings from the implementation.

### Milestone 4: Close-out

- [ ] Verify all acceptance criteria from `projects/mongo-orm-poc/spec.md` are met
- [ ] Verify no Mongo package imports from `2-sql/*` or `3-extensions/*` (`pnpm lint:deps`)
- [ ] Record design decisions made during implementation in Mongo design docs (relation storage details, variant type merging, ORM client architecture)
- [ ] Update [mongo-poc-plan.md](../../docs/planning/mongo-target/1-design-docs/mongo-poc-plan.md) Phase 3 with outcomes
- [ ] Update ADRs if any decisions changed during implementation
- [ ] Migrate long-lived documentation into `docs/planning/mongo-target/`
- [ ] Strip repo-wide references to `projects/mongo-orm-poc/**`
- [ ] Delete `projects/mongo-orm-poc/`

## Test Coverage

| Acceptance Criterion | Test Type | Milestone | Notes |
|---|---|---|---|
| `MongoContract` has `roots` section | Type-level | M1 | Compile-time check |
| `model.fields` is a string array | Type-level | M1 | Compile-time check |
| `model.storage` has collection + field-to-codec mappings | Type-level | M1 | Compile-time check |
| Model has `discriminator` + `variants` with sibling variants | Type-level | M1 | Compile-time check |
| Relations have `"strategy": "reference"` and `"strategy": "embed"` | Type-level | M1 | Compile-time check |
| `contract.json` and `contract.d.ts` exist | Manual | M1 | File existence |
| ORM presents root-based accessors from `roots` | Integration | M2 | `db.tasks`, `db.users` exist |
| `findMany` returns typed rows inferred from contract | Integration | M2 | Compilation + runtime assertion |
| Basic equality filters work | Integration | M2 | Filter by field, verify results |
| `include` traverses referenced relation | Integration | M2 | `include: { assignee: true }` |
| `include` traverses embedded relation | Integration | M2 | `include: { comments: true }` |
| Polymorphic root returns discriminated union | Integration + Type-level | M2 | Runtime: results include variants. Types: union type narrowable |
| Full flow: ORM → plan → runtime → driver → typed results | Integration | M2 | End-to-end test |
| Same domain model compiles as Mongo and SQL contract | Type-level | M3 | Both `.d.ts` files compile |
| Domain sections identical between Mongo and SQL | Type-level | M3 | Static structural comparison |
| Only `model.storage` and `storage` differ | Type-level | M3 | Verify divergence is scoped |
| No Mongo imports from `2-sql/*` or `3-extensions/*` | Automated | M4 | `pnpm lint:deps` |

## Open Items

- **Relation storage details** — the exact shape of join/embed info on relations must be designed in M1. See spec open question #3.
- **Variant type merging** — the `.d.ts` should express the full merged shape per variant (spec open question #2). Verify this works for the ORM's type inference.
- **`include` implementation strategy** — for referenced relations, should the ORM use `$lookup` (single aggregation pipeline) or multi-query stitching (separate `find` + application-level join)? Both approaches should be possible; pick the simpler one for the PoC and document the trade-off.
- **Embedded relation `include` semantics** — embedded documents are always present in the parent document. Does `include: { comments: true }` mean "project them into the result type" (they're already in the data) or is `include` unnecessary for embedded relations? The SQL ORM may handle this differently. Resolve during M2 implementation.
- **Package location for ORM client** — does the Mongo ORM client live in `2-mongo-family/` (as a lane or its own package) or `3-mongo-target/`? Resolve during M2 implementation.
