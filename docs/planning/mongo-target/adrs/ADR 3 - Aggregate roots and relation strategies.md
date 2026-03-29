# ADR 3 — Aggregate roots and relation strategies

> **Scope**: Mongo-target local ADR. Will be promoted to the repo-wide ADR directory when the contract redesign is implemented across both families.

## Context

Before this decision, the ORM's top-level access points were implicit. The ORM scanned the `models` section, checked which models had a `storage.table` property, and presented each as a top-level accessor (`db.user`, `db.post`). In the SQL world, this worked because every model has its own table — the distinction between "model" and "aggregate root" was invisible.

The Mongo PoC made this distinction visible. In MongoDB:

- A model can be **embedded** in another model's collection as a sub-document. It has no collection of its own and cannot be queried independently.
- A model can be a **polymorphic variant** stored in its parent's collection.
- A model can own its own collection and serve as an entry point for queries.

These are three different storage strategies, but the contract had no way to express them explicitly. The ORM had to infer "is this model an aggregate root?" from the presence of storage metadata.

Similarly, relations between models had no storage strategy information. The relation graph described cardinality (1:1, 1:N, N:M) but not *how* the relation was stored — whether the related entity was embedded in the parent document or referenced across collections/tables.

## Problem

Two related questions:

1. **Aggregate roots**: How does the contract explicitly declare which models are ORM entry points (queryable directly), vs models that are only accessible through a parent?
2. **Relation strategies**: How does the contract distinguish between a relation that stores the related entity by reference (cross-collection/cross-table join) and one that stores it by embedding (nested in the parent document/JSON column)?

## Alternatives considered for aggregate roots

### Alternative 1: Implicit from storage metadata

The current approach: if a model has `storage.table` (SQL) or `storage.collection` (Mongo), it's an aggregate root.

**Why we rejected it**: This works for SQL where every model has a table, but breaks for Mongo. A polymorphic variant shares its parent's collection — it has `storage.collection` (or inherits it) but is not an independent entry point. An embedded model has no collection at all. The ORM can't distinguish "this model is an entry point with its own collection" from "this model shares a collection as a variant" without additional context.

More fundamentally, this is the one major concept in the contract that was derived rather than declared. The contract is explicit about models, fields, relations, storage units, capabilities, and codecs — every important concept is named and directly readable. But "which models are aggregate roots" required cross-referencing models against their storage property. That's an odd inconsistency for a contract designed to be machine-readable and self-describing.

### Alternative 2: `strategy` on the model

```json
{
  "User": { "strategy": "root", "fields": [...] },
  "Comment": { "strategy": "embedded", "fields": [...] }
}
```

**Why we rejected it**: This conflates the model's domain identity with its storage role. A model can be an entity (has identity, lifecycle matters) regardless of how it's stored. The same model could be an aggregate root in one deployment and embedded in another. More practically, `strategy` as an enum is not extensible and creates a false choice between "root" and "embedded" when these are actually orthogonal properties — a model's root-ness comes from appearing in `roots`, and its embedded-ness comes from how a parent relates to it.

See [ADR 2](ADR%202%20-%20Polymorphism%20via%20discriminator%20and%20variants.md) for why labeling strategies as enums is problematic in general.

### Alternative 3: Move storage off the model, onto roots

```json
{
  "roots": {
    "users": { "model": "User", "table": "users", "fields": { "id": { "column": "id" } } }
  },
  "models": { "User": { "fields": ["id", "email"] } }
}
```

**Why we rejected it**: This cleanly separates domain from storage at the JSON structure level, but it breaks co-location for SQL. Field-to-column mappings (`"id": { "column": "id" }`) need their table context nearby. Putting the table on a `roots` entry and the column mappings on the model would leave column references dangling without their table, making the JSON fragile and harder to read. See [ADR 1](ADR%201%20-%20Contract%20domain-storage%20separation.md) for the full co-location rationale.

## Decision

### Aggregate roots: explicit `roots` section

The contract has a top-level `roots` section that maps ORM accessor names to model names:

```json
{
  "roots": {
    "tasks": "Task",
    "users": "User"
  }
}
```

- **Presence in `roots` means the model is an aggregate root.** No `strategy` field needed on the model. No inference required.
- **The root name controls the ORM accessor name.** If you want `db.tasks` (plural) but the model is `Task` (singular), the roots mapping handles it. Pluralization, casing, and naming are the emitter's concern.
- **Models not in `roots`** are accessed through relations (embedded) or through the base model (polymorphic variants).
- **Orphaned models** (not in `roots` and not referenced by any relation) are structurally valid but should produce an emitter warning. The contract is a static artifact — the emitter can flag these at emission time.

This is a small addition to the contract structure with a large payoff: any consumer (agent, library, human) can immediately see "these are the entry points" by reading `roots`, without inference. The contract remains self-describing.

### Relation strategies: `reference` vs `embed`

Each relation declares a storage strategy:

```json
{
  "User": {
    "relations": {
      "posts": { "to": "Post", "cardinality": "1:N", "strategy": "reference" },
      "addresses": { "to": "Address", "cardinality": "1:N", "strategy": "embed" }
    }
  }
}
```

- **`"reference"`**: Cross-collection/cross-table relation. Resolved at query time via JOIN (SQL) or `$lookup`/application-level stitching (Mongo). Both models are independent aggregate roots with their own storage units.
- **`"embed"`**: The related model is nested inside the parent's document (Mongo) or JSON column (SQL). The embedded model has no storage unit of its own — its data lives within the parent's storage.

### Embedding is a relation property, not a model property

The parent model's relation declares the embedding. The embedded model itself doesn't know *where* it's embedded — it just has fields and field-to-codec mappings (but no table/collection name in its `storage` block).

This design means:

- **The same model can be embedded in different parents.** A `Comment` model could be embedded in both `Post` and `Video`, via two separate relations.
- **The embedded model's location is implicit** — follow the `"strategy": "embed"` relation from the parent. This is the same indirection pattern used for polymorphic variants (you find them by reading the base model's `variants`).
- **Embedding strategy can change independently of the model.** If you later decide to move Comments from embedded to a separate collection, you change the relation strategy and add a `storage.collection` to Comment. The Comment model's fields don't change.

### Entity vs value type distinction

Not everything embedded is a model. There's a fundamental DDD distinction:

- **Entity (model)**: Has unique identity and a lifecycle that matters. An embedded `Post` with its own `_id` is still an entity even though it lives inside a User document. It appears in the `models` section.
- **Value type**: No identity, no lifecycle. An `Address` defined entirely by its fields is interchangeable with any other Address that has the same values. Value types belong in a `types`/`composites` section (not yet designed), not in `models`.

The current PSL conflates these by using `model` for "has a collection" and `type @embedded` for "is embedded." This misrepresents entities that happen to be stored embedded (e.g., a Post with `_id` embedded in a User document). The redesigned contract fixes this: all entities are in `models` regardless of storage strategy. Value types are a separate concept.

## Consequences

### Benefits

- **Aggregate roots are immediately visible** without inference. Machine-readable, human-readable, agent-friendly.
- **Relation strategies make embedding explicit.** Consumer libraries traversing the relation graph can distinguish embedded from referenced relations without inspecting storage metadata.
- **Embedding is composable.** A model can be embedded in multiple parents. An embedded model can be polymorphic. An aggregate root can have both embedded and referenced relations.
- **Value types get their own concept** rather than being shoehorned into models with a special flag.

### Costs

- **Relation storage details are not yet designed.** A `"strategy": "reference"` relation needs join details (SQL: foreign key columns; Mongo: which field holds the ObjectId). A `"strategy": "embed"` relation needs to know which field/path in the parent holds the embedded data. The exact shape is TBD.
- **Many-to-many without a join model** (Mongo: `student.courseIds: ObjectId[]`) doesn't fit cleanly into `reference` or `embed`. It may need a third strategy (e.g., `"junction"`) or a way to express "this relation is stored as an array of ObjectIds on the parent." Not yet designed.
- **Value types / composites section** is not yet designed. Until it exists, value objects (Address, GeoPoint) must be represented as models, which is semantically incorrect.

### Open questions

- **Relation storage details**: What's the shape of family-specific join info on `reference` relations? What field on the parent holds an `embed` relation's data?
- **Many-to-many**: Does a junction table appear as a model? Probably not — it's storage machinery, not a domain entity. But the relation needs to reference it somehow.
- **`nullable` on relations**: Can a reference relation be nullable (User may not have an assignee)? Where does this live — on the relation, on the field, or on the storage?

## Related

- [ADR 1 — Contract domain-storage separation](ADR%201%20-%20Contract%20domain-storage%20separation.md) — why `model.storage` stays on the model
- [ADR 2 — Polymorphism via discriminator and variants](ADR%202%20-%20Polymorphism%20via%20discriminator%20and%20variants.md) — why strategy labels are problematic
- [design-questions.md § DQ #1](../1-design-docs/design-questions.md) — embedded documents resolution
- [cross-cutting-learnings.md § learning #1](../cross-cutting-learnings.md) — explicit aggregate roots
- [cross-cutting-learnings.md § learning #5](../cross-cutting-learnings.md) — models are entities, not just data descriptions
