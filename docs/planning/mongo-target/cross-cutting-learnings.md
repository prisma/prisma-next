# Cross-Cutting Learnings

> **Note**: The proven learnings from this document have been promoted to the main architecture docs:
> - Contract design principles, domain/storage separation, polymorphism, embedded types, entity vs value type → [1. Data Contract.md § Cross-family contract design](../../architecture%20docs/subsystems/1.%20Data%20Contract.md)
> - Shared ORM Collection interface → [3. Query Lanes.md § Shared Collection interface across families](../../architecture%20docs/subsystems/3.%20Query%20Lanes.md)
> - Full MongoDB Family overview → [10. MongoDB Family.md](../../architecture%20docs/subsystems/10.%20MongoDB%20Family.md)
>
> This file is retained as a historical reference. The open questions below remain active.

Running record of insights from the Mongo workstream that affect the framework core or other families. These are findings that transcend the Mongo domain and will need to be applied to the broader architecture.

When a learning has been fully applied (code and docs updated across all affected domains), remove it from this document.

---

## Contract design principles

These principles emerged from the contract redesign discussion and apply to the entire contract, not just Mongo.

1. **The domain model is self-describing.** Reading the `roots`, `models`, and `relations` sections should give a complete picture of the application domain without consulting the storage block. The domain describes *what* the application models and how they relate; storage describes *how* they persist.
2. **Domain and persistence are separated.** Models describe the application domain (fields, relations, identity, polymorphism). Storage describes the database (tables, columns, collections, indexes). The bridge between them is `model.storage` — scoped and family-specific.
3. **Family-specific details are scoped.** The contract's top-level structure (`roots`, `models`, `relations`) is family-agnostic. Family-specific persistence details live inside `model.storage` and the top-level `storage` section.
4. **The contract describes facts, not instructions.** The contract states what exists (models, fields, storage units, discriminators) — the ORM decides how to represent it at runtime (class hierarchy, flat types, composition). Persistence strategies (STI vs MTI) are emergent from the combination of domain declarations and storage mappings, not labeled.

---

## 1. The contract needs a `roots` section for aggregate roots

**Source**: M2 design discussion, contract redesign

The ORM's top-level access points (`db.tasks`, `db.users`) correspond to **aggregate roots** — entities that own a storage unit and serve as the entry point for all access to entities within that aggregate. Today, aggregate roots are implicit: the ORM scans `models`, checks which ones have `storage.table`, and presents those. This should be explicit.

The contract should have a `roots` section that maps ORM accessor names to model names:

```json
{
  "roots": {
    "tasks": "Task",
    "users": "User"
  }
}
```

- Presence in `roots` means the model is an aggregate root — no `strategy` field needed on the model.
- The root name controls the ORM accessor name (pluralization, casing — the emitter decides).
- Models not in `roots` are accessed through relations (embedded models) or via variant relationships (polymorphic models).

**Where to apply**: Contract type system (`packages/1-framework/1-core/shared/contract/`), emitter, ORM client for both families.

---

## 2. The shared contract base: domain/storage separation with `model.storage` as the family-specific bridge

**Source**: M2 implementation + contract redesign

The original plan was to keep `MongoContract` structurally parallel to `SqlContract` for mechanical extraction. The M2 implementation proved this isn't feasible — the shapes diverge because SQL and Mongo have different sources of truth for data structure (database schema vs application models).

The contract redesign found the right abstraction: separate domain from persistence, with `model.storage` as the scoped, family-specific bridge.

**Model structure** — family-agnostic:

- `fields` — record mapping field names to domain metadata (e.g. `{ "email": { "nullable": false, "codecId": "pg/text@1" } }`). Keys are the domain vocabulary; values carry `nullable` (required boolean) and `codecId` (the field's type). Codec identifiers are a family-agnostic concept — "family-agnostic" describes the *structure* of the domain section, not its *values*.
- `discriminator` + `variants` — optional, for polymorphism
- `relations` — connections to other models

`**model.storage`** — family-specific bridge:

SQL maps fields to column names (because SQL has a genuine field → column indirection):

```json
{ "table": "tasks", "fields": { "id": { "column": "id" }, "title": { "column": "title" } } }
```

Mongo needs only the collection name (no field mappings — the domain fields map directly to document fields):

```json
{ "collection": "tasks" }
```

The co-location of table name with field-to-column mappings in SQL is intentional — separating them would leave column references dangling.

**Where to apply**: `packages/1-framework/1-core/shared/contract/`, both family contract types, emitter. See [contract-symmetry.md](1-design-docs/contract-symmetry.md) for the convergence/divergence analysis.

---

## 3. Nested/embedded types are a cross-family concern

**Source**: M2 implementation, contract redesign

Embedded documents in Mongo and typed JSON columns in SQL are the same contract-level problem: structured data nested within a parent entity. Both need type-safe dot-notation queries, TypeScript type generation, and reusability across models.

**Embedding is a relation property, not a model property.** The parent model's relation declares the embedding strategy (`"strategy": "embed"`); the embedded model doesn't know where it's embedded. An embedded model has its own `fields` and `storage` (field-to-codec mappings) but no table/collection name — it doesn't own a storage unit.

The entity vs value type distinction matters: an embedded **entity** (e.g., a Post with `_id` embedded in User) has identity and lifecycle. An embedded **value type** (e.g., Address) has no identity — it belongs in a `types`/`composites` section, not `models`.

**Where to apply**: Contract type system, authoring surfaces, emitter, query builder. See [design-questions.md § DQ #1](1-design-docs/design-questions.md#1-embedded-documents-relation-field-or-distinct-concept-cross-family-concern).

---

## 4. Polymorphism: `discriminator` + `variants` as the domain primitive

**Source**: Contract redesign

All persistence-level polymorphism reduces to "multiple shapes in the same storage, distinguished by a field." This is fundamental enough to be a contract-level primitive.

The base model declares a `discriminator` (which field) and `variants` (which models are specializations, with their discriminator values). Each variant names its `base` model and appears as a sibling in the `models` dictionary with its own additional fields and storage mappings:

```json
"models": {
  "Task": {
    "fields": {
      "id": { "nullable": false, "codecId": "pg/int4@1" },
      "title": { "nullable": false, "codecId": "pg/text@1" },
      "type": { "nullable": false, "codecId": "pg/text@1" }
    },
    "discriminator": { "field": "type" },
    "variants": { "Bug": { "value": "bug" }, "Feature": { "value": "feature" } },
    "storage": { "table": "tasks", "fields": { ... } }
  },
  "Bug": {
    "base": "Task",
    "fields": { "severity": { "nullable": false, "codecId": "pg/text@1" } },
    "storage": { "table": "tasks", "fields": { ... } }
  },
  "Feature": {
    "base": "Task",
    "fields": { "priority": { "nullable": false, "codecId": "pg/int4@1" } },
    "storage": { "table": "features", "fields": { ... } }
  }
}
```

The relationship is bidirectional: the base model's `variants` answers "what are Task's specializations?", and each variant's `base` answers "what model does Bug specialize?" This eliminates the need for consumers to build a reverse index. Both sides are redundant (the emitter writes both), but each serves a different traversal.

We use **specialization/generalization** terminology, not OOP inheritance language. `base` was chosen over `extends` because it describes a structural relationship ("Bug's base is Task") without implying runtime behavior (class hierarchies, method overriding, Liskov substitution). The contract says "Bug is a specialization of Task" (a domain fact about the data). Whether the ORM represents this as class inheritance, composition, or flat types is a runtime decision the contract doesn't make.

The persistence strategy is **emergent**: if Bug's storage points to the same table as Task, it's STI. If it points to a different table, it's MTI. The domain declaration (`discriminator` + `variants` + `base`) doesn't change — only the storage mappings do.

Polymorphism is **orthogonal to aggregate root / embedded** — any model can be polymorphic, whether it's a root, a variant, or embedded.

**Mongo-specific constraint: STI only.** Because MongoDB has no joins, all variants of a base model must share the same collection (single-table inheritance). Multi-table inheritance (variants in different collections) is a valid SQL persistence strategy but not supported in Mongo. This is enforced by `validateMongoStorage()` — it is a storage constraint, not a domain-level one. The domain declaration (`discriminator` + `variants` + `base`) is family-agnostic; only the storage validation differs.

**Where to apply**: Contract type system, emitter, ORM client, PSL authoring. This is a cross-family concern — SQL STI and Mongo polymorphic collections use the same representation.

---

## 5. Models are entities; value types are a separate concept

**Source**: M2 design discussion

A **model** (entity) has unique identity and a lifecycle that matters to the application. A **value type** has no identity — it's defined entirely by its properties. Two instances with the same values are interchangeable.

The `models` section describes all entities regardless of storage strategy. Storage strategy (own table/collection vs embedded in parent) is orthogonal to identity. Types/value objects are a separate, simpler concept — named field structures with no identity semantics — and belong in a `types` or `composites` section.

Today the framework treats models as pure data descriptions (no behavior). Framing models as entities keeps the door open for a natural future extension: letting users define the class instantiated for each entity retrieved from a collection, turning collections into proper repositories and models into real OOP entities with behavior.

**Where to apply**: Contract type system, PSL authoring syntax, emitter.

---

## 6. The ORM Collection interface is a shared architectural pattern

**Source**: Phase 3 Mongo ORM PoC + comparative analysis with SQL ORM

Building a Mongo ORM client alongside the existing SQL ORM revealed that the consumer-facing surface is fundamentally the same pattern across families. The `Collection` class with fluent chaining (`.where().select().include().take().all()`) is the shared ORM interface — not an options-bag API like `findMany({ where, include })`.

**What's shared (framework-level):**

- `**Collection` chaining API.** Immutable method chaining where each call returns a new collection with accumulated state. Both families use the same method vocabulary: `where`, `select`, `include`, `orderBy`, `take`, `skip`, `all`, `first`.
- `**CollectionState`.** The family-agnostic state bag (filters, includes, orderBy, selectedFields, limit, offset). Chaining methods accumulate state; terminal methods (`.all()`, `.first()`) compile it into a family-specific query plan.
- **Row type inference.** Both families follow `model.fields[f].codecId` → `CodecTypes[codecId]['output']` with nullable handling. This is a framework-level utility type, not per-family.
- **Custom collection subclasses.** `class UserCollection extends Collection<Contract, 'User'>` with domain methods like `.admins()` and `.byEmail(email)`. Nothing about this pattern is SQL-specific.
- **Include interface.** `include('relation', refineFn?)` with cardinality-aware coercion (to-one → `T | null`, to-many → `T[]`). The refinement callback produces a nested collection with its own state.
- **Client = map of root names → Collection instances.** Both families derive this from the contract's `roots` section.

**What stays family-specific (internal plumbing):**

- **Terminal compilation.** `.all()` compiles `CollectionState` → `SqlQueryPlan` (SQL AST) vs `MongoQueryPlan` (FindCommand / AggregateCommand).
- **Include resolution strategy.** SQL uses lateral joins, correlated subqueries, or multi-query stitching. Mongo uses `$lookup` pipeline stages. Embedded relations in Mongo are auto-projected (no loading needed).
- **Where expression compilation.** SQL compiles to SQL AST nodes. Mongo compiles to filter documents. The callback DSL shape (`.email.eq(...)`) could share the same signature, but the output types differ.
- **Field mapping.** SQL needs column remapping via `model.storage.fields`. Mongo uses identity mapping by default.
- **Mutation compilation.** SQL has `INSERT...RETURNING`, `ON CONFLICT`, FK cascades. Mongo has `insertOne`/`updateOne` with update operators.

**Approach: spike then extract.** Build the Mongo Collection independently, mirroring the SQL ORM's chaining API shape. Once both families have working Collection implementations, extract the shared interface from two concrete implementations. The abstraction is discovered, not predicted.

The Phase 3 options-bag API (`findMany({ where, include })`) was expedient for proving the contract shape but is not the target design. Phase 4 will reimplement the Mongo ORM with the chaining Collection pattern.

**Where to apply**: `packages/1-framework/` (shared Collection interface and CollectionState), both family ORM packages. See [ADR 175](../../architecture%20docs/adrs/ADR%20175%20-%20Shared%20ORM%20Collection%20interface.md).

---

## Open contract design questions

These emerged from the contract redesign and need resolution before implementation.

### Polymorphic associations

A `Comment` can belong to either a `Post` or a `Video`, distinguished by a `commentable_type` discriminator column. This is polymorphism on the *relation*, not the model. The `relations` section would need to express "this relation can point to one of several models."

### Many-to-many without a join model

In Mongo, `student.courseIds: ObjectId[]` represents a many-to-many without a junction collection. In SQL, the junction table exists but has no domain identity — it's pure storage machinery, not a domain entity.

### Row type naming: `InferFullRow` vs `DefaultModelRow`

The Mongo ORM introduces `InferFullRow` (scalar fields + embedded relation fields) which corresponds to SQL's `DefaultModelRow`. The naming asymmetry is intentional but needs resolution before the shared contract base is extracted:

- `InferFullRow` uses "Row" vocabulary which is SQL-native — Mongo deals in documents, not rows.
- SQL's `DefaultModelRow` uses "default" which is ambiguous ("default compared to what?").
- Options: `InferFullModel` (clearer for Mongo, breaks Row symmetry), keep `InferFullRow` with documented rationale, or introduce a family-agnostic name like `InferModelShape`.

This should be resolved when extracting the shared contract base type.

### Relation storage details

Relations with `"strategy": "reference"` need family-specific join details (SQL: foreign key columns; Mongo: which field holds the ObjectId). Relations with `"strategy": "embed"` need to know which field in the parent document holds the embedded data.

### `nullable` and `codecId` location *(resolved)*

Both are **domain concepts** and live on `model.fields`:

- `**nullable`** — "can a User have no email?" is a business rule that directly affects type inference (`string` vs `string | null`). Both families need it identically.
- `**codecId**` — the field's type. Describing a field without its type leaves the domain section incomplete. The codecId *concept* is family-agnostic (every family uses codec identifiers); the specific IDs available depend on framework composition, but that's a composition concern, not a structural one. "Family-agnostic" describes the structure of the domain section, not its values.

```json
{ "id": { "nullable": false, "codecId": "pg/int4@1" }, "email": { "nullable": false, "codecId": "pg/text@1" }, "name": { "nullable": true, "codecId": "pg/text@1" } }
```

`nullable` is a required `boolean` — always present, never omitted. This follows design principle #1 ("the domain model is self-describing"): a reader should understand a field's nullability by looking at it, without knowing the contract's default conventions. Explicit `false` eliminates ambiguity between "not nullable" and "not yet specified," and makes contract diffs clearer (`false → true` vs `undefined → true`).

Moving `codecId` to the domain field narrows the storage divergence: Mongo's `model.storage` shrinks to just the collection name, while SQL's retains field-to-column mappings because SQL has a genuine indirection layer. The remaining divergence is more honest — it reflects a real structural difference, not an artifact of where the codec was placed.

---

## Maintenance

This document is maintained alongside the Mongo design documents. Add entries when:

- A Mongo PoC milestone reveals something that affects the framework core or another family
- A design discussion surfaces a cross-cutting concern

Remove entries when the learning has been fully applied (code changes landed, design docs updated across all affected domains, ADR written if needed).

Cross-reference from the relevant Mongo design docs (use `[cross-cutting-learnings.md](../cross-cutting-learnings.md)`) so readers discover these learnings in context.