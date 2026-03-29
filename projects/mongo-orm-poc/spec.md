# Summary

Implement the redesigned contract structure (ADRs 1-3) and build a minimal read-only Mongo ORM client that validates the contract carries enough information for polymorphism, embedded documents, referenced relations, and type inference — proving the domain/storage separation design works end-to-end.

# Description

The [mongo-execution-poc](../mongo-execution-poc/spec.md) proved the Mongo execution pipeline works. The subsequent contract redesign discussion produced three ADRs defining a new contract structure: domain/storage separation ([ADR 1](../../docs/planning/mongo-target/adrs/ADR%201%20-%20Contract%20domain-storage%20separation.md)), polymorphism via `discriminator` + `variants` + `base` ([ADR 2](../../docs/planning/mongo-target/adrs/ADR%202%20-%20Polymorphism%20via%20discriminator%20and%20variants.md)), and aggregate roots with relation strategies ([ADR 3](../../docs/planning/mongo-target/adrs/ADR%203%20-%20Aggregate%20roots%20and%20relation%20strategies.md)).

These decisions are design-only — they haven't been tested with a real consumer. Type-level tests on the contract alone aren't sufficient; the contract is only proven by a consumer with real needs. This project builds that consumer: a minimal ORM client scoped to reads, with enough surface to exercise the critical contract features (roots, polymorphism, embedding, referenced relations). The ORM client's query interface should be consistent with the SQL ORM client where possible — structured filter objects, not Mongo-native dot notation.

This project is Phase 3 of the [MongoDB PoC](../../docs/planning/mongo-target/1-design-docs/mongo-poc-plan.md), part of [workstream 4](../../docs/planning/april-milestone.md#4-mongodb-poc--validate-the-second-database-family) of the April milestone.

# Requirements

## Functional Requirements

**Contract restructuring:**

- Restructure `MongoContract` to follow ADRs 1-3:
  - `roots` section mapping ORM accessor names to model names
  - `model.fields` as records of `{ nullable: boolean, codecId: string }` (domain metadata)
  - `model.storage` as the family-specific bridge (collection name for Mongo; table + field-to-column mappings for SQL)
  - `discriminator` + `variants` on polymorphic base models; `base` on each variant model
  - Relations with `strategy` (`"reference"` | `"embed"`)
- Hand-craft `contract.json` and `contract.d.ts` for a schema that exercises all features: polymorphic model (Task with Bug/Feature variants), referenced relation (Task → User), and at least one embedded relation (e.g. User with embedded Address, or Post with embedded Comments).

**Contract validation:**

- `validateMongoContract()` — a function that loads a Mongo contract from JSON and returns a typed, validated contract object. This is the Mongo equivalent of the SQL domain's `validateContract()` (see `packages/2-sql/1-core/contract/src/validate.ts`). It is the bridge between a JSON import and a typed contract the ORM client can trust.
- **Structural validation**: uses an Arktype schema to verify the JSON conforms to the `MongoContract` shape — `roots`, `models` with `fields` as `{ nullable: boolean, codecId: string }`, `storage`, `relations` with correct `strategy`-specific shapes, `discriminator`/`variants`/`base`.
- **Logical validation**: cross-references within the contract to catch inconsistencies that structural validation can't express. Every `roots` value must name an existing model. Every `variants` entry must name an existing model. Every variant's `base` must match the model that lists it in `variants` (bidirectional consistency). Every relation's `to` must name an existing model. Reference relations' `on.localFields`/`on.targetFields` must name fields that exist. Embed relations must target models with empty storage. Models with `discriminator` must have `variants`, and the discriminator field must exist in the model's `fields`.
- **Computed indices**: builds lookup structures the ORM will need — variant-to-base map, model-to-variants map — rather than forcing the ORM to scan every model's `variants` dictionary at query time.
- The function follows the SQL pattern: `validateMongoContract<TContract extends MongoContract>(value: unknown): TContract`, where the type parameter is the fully-typed contract from `contract.d.ts`.

**Minimal ORM client:**

- Root-based accessors derived from the contract's `roots` section (e.g. `db.tasks`, `db.users`).
- `findMany` on any root, returning correctly-typed rows with types inferred from the contract.
- Basic equality filters on model fields, using a structured filter object consistent with the SQL ORM client's query interface.
- `include` for referenced relations (`"strategy": "reference"`), resolving via `$lookup` or multi-query stitching.
- `include` for embedded relations (`"strategy": "embed"`), returning the embedded documents as part of the parent result.
- Polymorphic queries: querying a polymorphic root (e.g. `db.tasks.findMany()`) returns a discriminated union (Task | Bug | Feature) narrowable by the discriminator field.

**Cross-family contract symmetry:**

- Hand-craft the same domain model (Task/Bug/Feature/User) as both a Mongo contract and a SQL contract using the redesigned structure.
- The domain level (`roots`, `models` with `fields`/`discriminator`/`variants`/`base`, `relations`) is structurally identical between the two contracts (same TypeScript types; values like `codecId` differ per family) — only `model.storage` and top-level `storage` differ.

## Non-Functional Requirements

- All Mongo packages remain independent of SQL packages. No imports from `2-sql/*` or `3-extensions/*`.
- The ORM client must not prevent future addition of: writes, complex filters, `orderBy`, pagination, `select`, custom collection methods.
- The contract restructuring should not break existing M1/M2 tests (or they should be updated to use the new structure).

## Non-goals

- **Writes** (`create`, `update`, `delete`) — deferred to Phase 4 (full ORM client).
- **Complex filters** (`$gt`, `$in`, `$or`, logical operators) — basic equality filters are sufficient to prove the contract.
- `**orderBy`, pagination** (`take`/`skip`), `**select`** (field projection) — ORM convenience features, not contract validation concerns.
- **Custom collection classes or methods** — the ORM presents the same interface for all roots.
- **Aggregation pipeline DSL** — raw pipeline passthrough exists from M1; a typed builder is a separate project.
- **Shared ORM interface extraction** — building the Mongo ORM independently first; extraction happens after both families have working ORM clients.
- **Emitter / authoring surfaces** — contracts are hand-crafted.
- **Modifying `ContractBase`** — the Mongo contract is independent; shared base extraction is a follow-on.

# Acceptance Criteria

**Contract structure:**

- `MongoContract` has a `roots` section mapping accessor names to model names
- `model.fields` is a record mapping field names to `{ nullable: boolean, codecId: string }`
- `model.storage` contains collection name (Mongo) or table + field-to-column mappings (SQL)
- At least one model has `discriminator` + `variants` with variant models as siblings; each variant has `base` referencing the base model
- At least one relation has `"strategy": "reference"` and at least one has `"strategy": "embed"`
- `contract.json` and `contract.d.ts` exist for the test schema

**Contract validation:**

- `validateMongoContract()` accepts a valid contract JSON and returns a typed contract
- `validateMongoContract()` rejects contracts with structural errors (missing fields, wrong types)
- `validateMongoContract()` rejects contracts with logical errors (dangling model references in `roots`, `variants`, `relations`; bidirectional inconsistency between `base` and `variants`)
- `validateMongoContract()` produces computed indices (variant-to-base map, model-to-variants map)

**ORM client:**

- ORM client presents root-based accessors derived from the `roots` section
- `findMany` returns correctly-typed rows with types inferred from the contract (not manually specified)
- Basic equality filters work on model fields
- `include` traverses a referenced relation and returns related documents
- `include` traverses an embedded relation and returns embedded documents
- Querying a polymorphic root returns a discriminated union narrowable by the discriminator field
- A test exercises the full flow: ORM client → query plan → runtime → driver → `mongodb-memory-server` → typed results

**Cross-family symmetry:**

- The same domain model compiles as both a Mongo contract and a SQL contract
- `roots`, `models` (with `fields`, `discriminator`, `variants`, `base`), and `relations` sections are structurally identical between the two contracts (same shape; `codecId` values differ per family)
- Only `model.storage` and top-level `storage` differ

**Architecture:**

- No Mongo package imports from `2-sql/`* or `3-extensions/*`

# Other Considerations

## Security

Not applicable — internal infrastructure with no user-facing surface.

## Cost

No additional infrastructure cost. `mongodb-memory-server` is already set up from the execution PoC.

## Observability

Not applicable at this stage.

## Data Protection

Not applicable — no production data, no PII.

## Analytics

Not applicable.

# References

- [Mongo PoC (Linear)](https://linear.app/prisma-company/project/mongo-poc-89d4dcdbcd9a)
- [ADR 1 — Contract domain-storage separation](../../docs/planning/mongo-target/adrs/ADR%201%20-%20Contract%20domain-storage%20separation.md)
- [ADR 2 — Polymorphism via discriminator and variants](../../docs/planning/mongo-target/adrs/ADR%202%20-%20Polymorphism%20via%20discriminator%20and%20variants.md)
- [ADR 3 — Aggregate roots and relation strategies](../../docs/planning/mongo-target/adrs/ADR%203%20-%20Aggregate%20roots%20and%20relation%20strategies.md)
- [Mongo PoC plan (Phase 3)](../../docs/planning/mongo-target/1-design-docs/mongo-poc-plan.md)
- [Cross-cutting learnings](../../docs/planning/mongo-target/cross-cutting-learnings.md)
- [Contract symmetry](../../docs/planning/mongo-target/1-design-docs/contract-symmetry.md)
- [Design questions](../../docs/planning/mongo-target/1-design-docs/design-questions.md)
- [Example schemas](../../docs/planning/mongo-target/1-design-docs/example-schemas.md)
- [mongo-execution-poc](../mongo-execution-poc/spec.md) — predecessor project

# Decisions

1. **Restructure before building.** Implement the ADR contract structure first, then build the ORM client on top. Don't build on the M2 contract and retrofit later.
2. **Reads only.** The ORM client is scoped to `findMany` — enough to validate the contract without the complexity of mutation semantics (`$inc`, `$push`, etc.).
3. **Consistent query interface.** Filters use structured objects matching the SQL ORM's patterns. The ORM compiles these to Mongo's native query format internally.
4. **Embedded documents in scope.** Embedding is fundamental to idiomatic Mongo usage. The "cross-family concern" label means the solution should work for both families eventually, not that Mongo must wait for SQL.
5. **`codecId` and `nullable` live on `model.fields` (domain level).** Both are domain concepts needed by every consumer for type inference. `codecId` as a concept is family-agnostic — every family uses codec identifiers. "Family-agnostic" describes the *structure* of the domain section, not its *values*. This means Mongo's `model.storage` shrinks to just the collection name (no field-to-codec mappings in storage), while SQL's retains field-to-column mappings. The `model.storage.fields` mechanism remains available to Mongo for field name remapping if needed.
6. **Variants carry `base`; use specialization/generalization terminology.** Each variant model has a `base` property naming the model it specializes (e.g., `Bug.base = "Task"`). The base model's `variants` lists its specializations. The relationship is bidirectional — both sides are emitted for different traversal needs. We use `base` instead of `extends` because it describes a structural fact without OOP inheritance baggage. The contract speaks of specializations (variants add fields to the base shape) and generalizations (the base defines the shared shape), not subclasses and superclasses.
7. **Contract validation before ORM construction.** Implement `validateMongoContract()` as the first step of M2, before building the ORM client. The contract has intentional redundancy (e.g., `base` ↔ `variants` bidirectionality, field names in `model.fields` and `model.storage.fields` for SQL) that creates opportunities for inconsistency in hand-crafted contracts. Validating structural shape (Arktype), logical consistency (cross-references), and building computed indices (variant-to-base map) in a single entry point means the ORM client can trust the contract it receives. This follows the SQL domain's pattern (`validateContract()` in `packages/2-sql/2-authoring/contract-ts/src/contract.ts`).

# Open Questions

1. **Test schema choice.** The SaaS task management example (Task/Bug/Feature + User) covers polymorphism and referenced relations. What should the embedded relation be? Options: User with embedded Addresses (simple, value-type-like), Post with embedded Comments (entity-like, tests identity in embedded docs). **Assumption:** include both — Address as a value-type embed, Comments as an entity embed — to test both patterns.
2. **Variant field resolution at the type level.** ADR 2 says variant models list only their own fields; they reference the base model via `base` and inherit its fields. How does this work in `contract.d.ts`? Does the type system express the full merged shape, or does the consumer need to merge base + variant fields? **Assumption:** the `.d.ts` expresses the full merged shape for each variant (Bug has id + title + type + severity), since that's what the ORM needs at runtime.
3. **Relation storage details.** ADR 3 notes that the exact shape of family-specific join info on relations is not yet designed. For `"strategy": "reference"`, what fields describe the join? For `"strategy": "embed"`, what field describes the embedding location? This must be resolved during implementation. **Assumption:** `"reference"` relations carry a `fields` property naming the local field(s) holding the foreign key/ObjectId; `"embed"` relations carry a `field` property naming the parent document field holding the embedded data.

