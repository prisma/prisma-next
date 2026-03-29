# ADR 2 — Polymorphism via discriminator and variants

> **Scope**: Mongo-target local ADR. Will be promoted to the repo-wide ADR directory when the contract redesign is implemented across both families.

## Context

Polymorphism is a cross-family concern. Both SQL and MongoDB need to represent multiple entity shapes in the same storage unit:

- **MongoDB**: Polymorphic collections are common — a `tasks` collection holding Bug, Feature, and Chore documents, distinguished by a `type` field. The MongoDB engineering team rates "Inheritance and Polymorphism" as their highest priority for Prisma integration.
- **SQL**: Single-table inheritance (STI) is common in Rails, Django, and many TS codebases — one table holds multiple model types, distinguished by a discriminator column. Multi-table inheritance (MTI) is also used.

Prisma ORM (v1) handles polymorphic Mongo collections by typing the discriminator as `Json` or using multiple optional fields, losing all type safety. Users specifically call this out as a pain point.

The contract needs to express polymorphism in a way that:

1. Works for both families
2. Supports at least STI (shared storage) and MTI (separate storage)
3. Produces TypeScript types that narrow correctly on the discriminator
4. Doesn't prescribe OOP patterns that the ORM should decide at runtime

## Problem

How does the contract represent the relationship between a base model (Task) and its variants (Bug, Feature)?

## Alternatives considered

### Alternative 1: `extends` on variant models

```json
{
  "Task": { "fields": ["id", "title", "type"], "storage": { "table": "tasks" } },
  "Bug": { "extends": "Task", "fields": ["id", "title", "type", "severity"], "storage": { "table": "tasks" } }
}
```

Each variant declares that it extends a base model. Variants list all fields (base + own).

**Why we rejected it**: `extends` is prescriptive — it carries OOP inheritance baggage (single inheritance, Liskov substitution, parent-child hierarchy) and tells the ORM *how* to think about the relationship. The contract should describe structural facts, not prescribe runtime patterns. Whether the ORM represents Bug as a subclass of Task, a separate class, or a composed type is a runtime decision the contract should not influence.

There's also a practical concern: `extends` encodes a directional parent-child relationship that doesn't cleanly map to all persistence strategies. In MTI, Bug has its own extension table joined to the base — the relationship is more "shares data with" than "inherits from."

### Alternative 2: `strategy` label on the model

```json
{
  "Task": { "strategy": "polymorphic", "discriminator": "type", "variants": ["Bug", "Feature"] },
  "Bug": { "strategy": "variant", "of": "Task" }
}
```

Each model explicitly labels its role in the polymorphic hierarchy.

**Why we rejected it**: Labeling the persistence strategy directly in the contract is not extensible. If a new strategy emerges (concrete table inheritance, for example), you'd need to add a new enum value to the contract schema. The contract should describe structural facts from which the ORM derives the query strategy — not hardcode the strategies it supports.

This also conflates two independent properties: whether a model is polymorphic (a domain concept) and how it's stored (a persistence concept). A model can be polymorphic *and* an aggregate root. A model can be an embedded variant. These are orthogonal properties that shouldn't be mashed into a single `strategy` enum.

### Alternative 3: `discriminator` + `variants` on the base, variants as thin siblings

This is what we chose. See Decision below.

## Constraints

- **The domain model must be self-describing.** Reading the `models` section should reveal the polymorphic structure without consulting `storage`. This is a core design principle (see [ADR 1](ADR%201%20-%20Contract%20domain-storage%20separation.md)).
- **Persistence strategy must be emergent.** The contract states facts; the ORM derives behavior. Whether the ORM queries one table (STI) or joins two (MTI) should follow from the storage mappings, not from a label.
- **The representation must be extensible.** Adding new persistence strategies for polymorphism (concrete table inheritance, materialized views, etc.) should not require changing the contract schema.
- **All models are siblings.** Base models, variants, and embedded models all appear as top-level entries in the `models` dictionary. This keeps enumeration and lookup simple.

## Decision

Polymorphism is expressed with two domain-level properties on the base model:

- **`discriminator`**: which field distinguishes the variants (`{ "field": "type" }`)
- **`variants`**: which models are specializations, and what discriminator value each uses (`{ "Bug": { "value": "bug" }, "Feature": { "value": "feature" } }`)

Each variant appears as a sibling in the `models` dictionary with its own fields and storage. Variant models list **only their own additional fields** — they inherit the base model's fields through the variant relationship.

```json
{
  "Task": {
    "fields": ["id", "title", "type", "assigneeId"],
    "discriminator": { "field": "type" },
    "variants": { "Bug": { "value": "bug" }, "Feature": { "value": "feature" } },
    "storage": { "table": "tasks", "fields": { ... } },
    "relations": { "assignee": { "to": "User", "cardinality": "N:1", "strategy": "reference" } }
  },
  "Bug": {
    "fields": ["severity", "stepsToReproduce"],
    "storage": { "table": "tasks", "fields": { ... } },
    "relations": {}
  },
  "Feature": {
    "fields": ["priority", "targetRelease"],
    "storage": { "table": "tasks", "fields": { ... } },
    "relations": {}
  }
}
```

### How persistence strategy becomes emergent

The ORM reads the storage mappings to determine query behavior:

- **STI**: Bug's storage points to `"table": "tasks"` (same as Task). The ORM queries one table with a discriminator filter.
- **MTI**: If Bug's storage pointed to `"table": "bugs"` instead, the ORM would JOIN `tasks` and `bugs` on the shared key. The domain declaration (`discriminator` + `variants`) doesn't change — only the storage mappings do.
- **Mongo**: All variants sharing a collection is the only option (no joins). Omitting the collection name in a variant's storage block implies it shares the base's collection.

New persistence strategies don't require new contract schema concepts — they're expressed through new storage mapping patterns.

### Why `discriminator` + `variants` is the right primitive

All persistence-level polymorphism reduces to "multiple shapes in the same storage, distinguished by a field." This is fundamental enough to bake into the contract. The contract says "Bug is a variant of Task, discriminated by the `type` field" — a domain fact about the data, not an instruction about OOP.

The ORM is free to interpret this however it wants at runtime:
- Class inheritance (Bug extends Task)
- Flat discriminated union type
- Composition
- Three independent classes

Today the framework treats models as pure data descriptions, but framing them as entities keeps the door open for future OOP model classes. The contract doesn't close that door or force it open.

### Why variant fields are thin

Variants list only their own additional fields, not the base model's fields. The `variants` relationship tells consumers that Bug inherits Task's fields. This avoids:

- **Redundancy**: Task has 4 fields; repeating them on Bug and Feature triples the field declarations.
- **Consistency risk**: If someone adds a field to Task but forgets to add it to Bug, the contract is inconsistent. With thin variants, the emitter handles inheritance — it can't get out of sync.
- **Cleaner domain reading**: Reading Bug's `fields: ["severity", "stepsToReproduce"]` tells you exactly what Bug adds to the base. The base fields are one lookup away.

### Polymorphism is orthogonal to other model roles

A model can be simultaneously:
- Polymorphic (has `discriminator` + `variants`) AND an aggregate root (appears in `roots`)
- A variant AND embedded (parent has `"strategy": "embed"`)
- Polymorphic AND embedded

These are independent properties, not a single `strategy` enum. This composability is why we rejected labeled strategies.

## Consequences

### Benefits

- **Self-describing domain**: reading the models section reveals the polymorphic structure without consulting storage.
- **Extensible**: new persistence strategies are expressed through storage mappings, not contract schema changes.
- **Cross-family**: the same representation works for SQL STI/MTI and Mongo polymorphic collections.
- **Minimal primitive**: `discriminator` + `variants` is the smallest domain concept that captures all persistence-level polymorphism.

### Costs

- **Variant field inheritance is implicit.** A reader must know that a variant inherits the base model's fields. This convention must be documented and understood by all contract consumers.
- **No explicit parent reference on variants.** To discover that Bug is a variant of Task, you must find the model that lists Bug in its `variants`. There's no back-reference on Bug itself. This is by design (avoids the prescriptive nature of `extends`), but it means some consumers will need to build an index.

### Open questions

- **Polymorphic associations**: A `Comment` that can belong to either a `Post` or a `Video` (distinguished by `commentable_type`) is polymorphism on the *relation*, not the model. The `relations` section would need to express "this relation can point to one of several models." Not yet designed.
- **ORM surface**: Does the ORM present separate collections for each variant (`db.bugs`, `db.features`) or only the base (`db.tasks`, returning a union)? This is an ORM design decision the contract doesn't prescribe — but the ORM team will need to decide.
- **Different discriminators on variants of variants**: What if Bug has its own sub-variants with a different discriminator field? Multi-level polymorphism is possible but adds complexity. Not yet designed.

## Related

- [ADR 1 — Contract domain-storage separation](ADR%201%20-%20Contract%20domain-storage%20separation.md)
- [ADR 3 — Aggregate roots and relation strategies](ADR%203%20-%20Aggregate%20roots%20and%20relation%20strategies.md)
- [design-questions.md § DQ #6](../1-design-docs/design-questions.md)
- [cross-cutting-learnings.md § learning #4](../cross-cutting-learnings.md)
