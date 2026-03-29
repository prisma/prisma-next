# Cross-Cutting Learnings

Running record of insights from the Mongo workstream that affect the framework core or other families. These are findings that transcend the Mongo domain and will need to be applied to the broader architecture.

When a learning has been fully applied (code and docs updated across all affected domains), remove it from this document.

---

## 1. A shared contract base requires a new abstraction

**Source**: M2 implementation (codecs and contract types)

The original plan was to keep `MongoContract` structurally parallel to `SqlContract` so extraction of a shared base would be mechanical. The implementation proved this isn't feasible — the shapes diverged meaningfully:

- SQL: `model field → column name → storage column → codecId → CodecTypes` (3 hops, column indirection)
- Mongo: `model field → codecId → CodecTypes` (2 hops, no indirection)

This divergence isn't arbitrary — it reflects a fundamental difference in where the source of truth for data structure lives (database schema in SQL, application models in Mongo).

A mechanical extraction would produce something either too loose to be useful or that forces one family into the other's shape. The right approach: implement both contracts fairly completely, then design a *new* abstraction rooted in common domain modeling concepts (see learning #4 below). This will probably require modifying both `SqlContract` and `MongoContract` to fit — producing a better result than either would alone.

**Where to apply**: `packages/1-framework/1-core/shared/contract/` — when both family contracts are mature enough to inform the shared base design.

---

## 2. Nested/embedded types are a cross-family concern

**Source**: M2 implementation

Embedded documents in Mongo (sub-documents, nested objects) are structurally identical to typed JSON columns in SQL. Both represent structured data nested within a parent entity. Both need:

- Type-safe dot-notation queries
- TypeScript type generation
- Reusability across models (e.g., `Address` used in both `User` and `Order`)
- Potentially recursive/self-referential structure

The difference is convention: in Mongo, embedding is idiomatic and common; in SQL, JSON columns are an escape hatch. But the contract-level problem — describing nested structured types and making them queryable — is identical.

This should be solved once for both families, not separately.

**Where to apply**: Contract type system, authoring surfaces, emitter, query builder. See [design-questions.md § DQ #1](1-design-docs/design-questions.md#1-embedded-documents-relation-field-or-distinct-concept-cross-family-concern).

---

## 3. The ORM client presents aggregate roots, not models

**Source**: M2 design discussion

The ORM client's top-level access points (`db.User`, `db.Post`) correspond to **aggregate roots** — entities that own a storage unit (collection or table) and serve as the entry point for all access to entities within that aggregate.

In SQL, every model has a root collection (table), so the distinction between "model" and "aggregate root" is invisible. In Mongo, that's not true — a model can be embedded in another model's collection. The ORM should present collections (aggregate roots), not models, as its top-level API.

In DDD terms: each aggregate root corresponds to a collection/table. Entities within the aggregate are accessed through the root, not independently.

**Where to apply**: ORM client design for both families. The SQL ORM already does this implicitly (every model has a table), but making the concept explicit would improve the framework's domain model.

---

## 4. A common domain model for the framework core

**Source**: M2 design discussion, synthesizing learnings #1-3

The concepts that emerged from the Mongo PoC aren't Mongo-specific — they're general data modeling concepts that apply equally to SQL and Mongo. Both families support the same four building blocks, differing only in convention and tooling:

| Concept | Definition | Mongo | SQL |
|---|---|---|---|
| **Aggregate root** | An entity that owns a storage unit and is the entry point for all access to entities within it | Collection | Table |
| **Entity** | Has unique identity and a lifecycle that matters to the application. May be an aggregate root or embedded within one | Sub-document with `_id` | JSON object/array with IDs (uncommon but possible) |
| **Value type** | Defined entirely by its properties. No identity, no lifecycle. Interchangeable with any instance of the same shape and values | Embedded document without `_id` | JSON/JSONB structured data |
| **Reference** | A cross-aggregate relation resolved at query time | ObjectId + `$lookup` | Foreign key + JOIN |

The difference between families isn't capability — both databases can do all four patterns. The difference is convention and tooling: SQL has better primitives for references (enforced foreign keys, JOIN optimization), so entities almost always get their own tables. Mongo has better primitives for embedding (atomic document writes, nested queries, `$elemMatch`), so embedding is common.

This gives us a path to pull common modeling concepts up from the family domains into the framework core. The contract's model layer could describe aggregates, entities, value types, and references in family-agnostic terms. Each family then maps these concepts to its storage primitives (collections/documents for Mongo, tables/columns/JSON for SQL).

This is the "new abstraction" that learning #1 identified as necessary — not a mechanical extraction of `SqlContract` or `MongoContract`, but a domain model rooted in these four concepts.

**Where to apply**: `packages/1-framework/1-core/` — contract type system, model definitions, relation graph. This is the most architecturally significant learning from the Mongo PoC.

---

## 5. Models are entities, not just data descriptions

**Source**: M2 design discussion

The distinction between a **model** and a **type** (or **value object**) should follow DDD and OOP principles:

- **Model (entity)** — has unique identity, a lifecycle that matters to the application, and conceptually carries associated business logic. Two users with identical names and emails are still *different users*, and deleting one is a meaningful change in application state.
- **Type (value object)** — defined entirely by its properties. No identity, no meaningful lifecycle. Two instances with the same field values are interchangeable.

The storage strategy (own collection vs. embedded) is orthogonal to this distinction. The current PSL conflates them by using `model` for "has a collection" and `type @embedded` for "is embedded," which misrepresents entities that happen to be stored embedded (e.g., a Post with its own `_id` embedded in a User document).

Today the framework treats models as pure data descriptions (no behavior). But framing models as entities keeps the door open for a natural future extension: letting users define the class instantiated for each entity retrieved from a collection — turning collections into proper repositories and models into real OOP entities with behavior.

For the contract, this suggests:

- The `models` section should describe all entities regardless of storage strategy
- Storage strategy (own collection vs. embedded in parent) should be metadata on the model
- Types/value objects are a separate, simpler concept — named field structures with no identity semantics
- A `types` or `composites` section in the contract could be shared across families

**Where to apply**: Contract type system, PSL authoring syntax, emitter.

---

## Maintenance

This document is maintained alongside the Mongo design documents. Add entries when:
- A Mongo PoC milestone reveals something that affects the framework core or another family
- A design discussion surfaces a cross-cutting concern

Remove entries when the learning has been fully applied (code changes landed, design docs updated across all affected domains, ADR written if needed).

Cross-reference from the relevant Mongo design docs (use `[cross-cutting-learnings.md](../cross-cutting-learnings.md)`) so readers discover these learnings in context.
