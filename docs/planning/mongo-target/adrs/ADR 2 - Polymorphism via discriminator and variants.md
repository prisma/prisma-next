# ADR 2 — Polymorphism via discriminator and variants

> **Scope**: Mongo-target local ADR. Will be promoted to the repo-wide ADR directory when the contract redesign is implemented across both families.

## At a glance

A polymorphic Task model with Bug and Feature variants. Task declares which field discriminates (`type`) and which models are variants. Each variant is a sibling in `models` listing only its own additional fields — it inherits the base model's fields through the variant relationship.

```json
{
  "roots": { "tasks": "Task" },
  "models": {
    "Task": {
      "fields": {
        "id": { "nullable": false, "codecId": "pg/int4@1" },
        "title": { "nullable": false, "codecId": "pg/text@1" },
        "type": { "nullable": false, "codecId": "pg/text@1" },
        "assigneeId": { "nullable": true, "codecId": "pg/int4@1" }
      },
      "discriminator": { "field": "type" },
      "variants": {
        "Bug": { "value": "bug" },
        "Feature": { "value": "feature" }
      },
      "relations": {
        "assignee": { "to": "User", "cardinality": "N:1", "strategy": "reference" }
      },
      "storage": {
        "table": "tasks",
        "fields": {
          "id": { "column": "id" },
          "title": { "column": "title" },
          "type": { "column": "type" },
          "assigneeId": { "column": "assignee_id" }
        }
      }
    },
    "Bug": {
      "fields": {
        "severity": { "nullable": false, "codecId": "pg/text@1" }
      },
      "relations": {},
      "storage": { "table": "tasks", "fields": { "severity": { "column": "severity" } } }
    },
    "Feature": {
      "fields": {
        "priority": { "nullable": false, "codecId": "pg/int4@1" }
      },
      "relations": {},
      "storage": { "table": "features", "fields": { "priority": { "column": "priority" } } }
    }
  }
}

```

Notice that the domain declaration (`discriminator`, `variants`, `fields`) is the same regardless of persistence strategy. Bug shares Task's table (single-table inheritance); Feature has its own table (multi-table inheritance). The ORM derives the query strategy from the storage mappings — the contract doesn't label it. See [ADR 1](ADR%201%20-%20Contract%20domain-storage%20separation.md) for why `model.fields` carries `nullable` and `codecId`.

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

## Constraints

- **The domain model must be self-describing.** Reading the `models` section should reveal the polymorphic structure without consulting `storage` (see [ADR 1](ADR%201%20-%20Contract%20domain-storage%20separation.md)).
- **Persistence strategy must be emergent.** The contract states facts; the ORM derives behavior. Whether the ORM queries one table (STI) or joins two (MTI) should follow from the storage mappings, not from a label.
- **The representation must be extensible.** Adding new persistence strategies for polymorphism (concrete table inheritance, materialized views, etc.) should not require changing the contract schema.
- **All models are siblings.** Base models, variants, and embedded models all appear as top-level entries in the `models` dictionary. This keeps enumeration and lookup simple.

## Alternatives considered

### `extends` on variant models

```json
{
  "Task": { "fields": { "id": { ... }, "title": { ... }, "type": { ... } }, "storage": { "table": "tasks" } },
  "Bug": { "extends": "Task", "fields": { "id": { ... }, "title": { ... }, "type": { ... }, "severity": { ... } }, "storage": { "table": "tasks" } }
}
```

Each variant declares that it extends a base model and lists all fields (base + own).

**Why we rejected it**: `extends` is prescriptive — it carries OOP inheritance baggage (single inheritance, Liskov substitution, parent-child hierarchy) and tells the ORM *how* to think about the relationship. The contract should describe structural facts, not prescribe runtime patterns. Whether the ORM represents Bug as a subclass of Task, a separate class, or a composed type is a runtime decision the contract should not influence. There's also a practical concern: `extends` encodes a directional parent-child relationship that doesn't cleanly map to MTI, where Bug has its own extension table joined to the base — the relationship is more "shares data with" than "inherits from."

### `strategy` label on the model

```json
{
  "Task": { "strategy": "polymorphic", "discriminator": "type", "variants": ["Bug", "Feature"] },
  "Bug": { "strategy": "variant", "of": "Task" }
}
```

Each model explicitly labels its role in the polymorphic hierarchy.

**Why we rejected it**: Labeling the persistence strategy directly is not extensible. If a new strategy emerges (concrete table inheritance, for example), you'd need to add a new enum value to the contract schema. This also conflates two independent properties: whether a model is polymorphic (a domain concept) and how it's stored (a persistence concept). A model can be polymorphic *and* an aggregate root. A model can be an embedded variant. These are orthogonal properties that shouldn't be mashed into a single `strategy` enum.

## Decision

Polymorphism is expressed with two domain-level properties on the base model:

- **`discriminator`**: which field distinguishes the variants (`{ "field": "type" }`)
- **`variants`**: which models are specializations, and what discriminator value each uses (`{ "Bug": { "value": "bug" }, "Feature": { "value": "feature" } }`)

Each variant appears as a sibling in the `models` dictionary with its own fields and storage. Refer to the [At a glance](#at-a-glance) example for the complete structure.

### Variant fields are thin

Variants list only their own additional fields — they inherit the base model's fields through the `variants` relationship. In the example above, Bug's `fields` contains only `severity`; it inherits `id`, `title`, `type`, and `assigneeId` from Task.

This avoids redundancy (Task has 4 fields; repeating them on each variant triples the declarations), eliminates consistency risk (the emitter handles inheritance — it can't get out of sync), and makes domain reading cleaner (Bug's `fields` tells you exactly what Bug *adds* to the base).

### Persistence strategy is emergent

The ORM reads the storage mappings to determine query behavior:

- **STI**: Bug's storage points to `"table": "tasks"` (same as Task). The ORM queries one table with a discriminator filter.
- **MTI**: Feature's storage points to `"table": "features"` (different from Task). The ORM JOINs `tasks` and `features` on the shared key.
- **Mongo**: All variants share a collection (no joins). A variant's storage inherits the base's collection.

The domain declaration (`discriminator` + `variants`) doesn't change across these strategies — only the storage mappings do. New persistence strategies don't require new contract schema concepts.

### Why `discriminator` + `variants` is the right primitive

All persistence-level polymorphism reduces to "multiple shapes in the same storage, distinguished by a field." This is fundamental enough to bake into the contract. The contract says "Bug is a variant of Task, discriminated by the `type` field" — a domain fact about the data, not an instruction about OOP.

The ORM is free to interpret this however it wants at runtime: class inheritance, flat discriminated union type, composition, or independent classes. The contract doesn't close that door or force it open.

### Polymorphism is orthogonal to other model roles

A model can be simultaneously:
- Polymorphic (has `discriminator` + `variants`) AND an aggregate root (appears in `roots`)
- A variant AND embedded (parent has `"strategy": "embed"`)
- Polymorphic AND embedded

These are independent properties. This composability is why we rejected labeled strategies — they create a false choice between roles that are actually orthogonal.

## Consequences

### Benefits

- **Self-describing domain**: reading the models section reveals the polymorphic structure without consulting storage.
- **Extensible**: new persistence strategies are expressed through storage mappings, not contract schema changes.
- **Cross-family**: the same representation works for SQL STI/MTI and Mongo polymorphic collections.
- **Minimal primitive**: `discriminator` + `variants` is the smallest domain concept that captures all persistence-level polymorphism.

### Costs

- **Variant field inheritance is implicit.** A reader must know that a variant inherits the base model's fields — this convention must be documented and understood by all contract consumers.
- **No explicit parent reference on variants.** To discover that Bug is a variant of Task, you must find the model that lists Bug in its `variants`. There's no back-reference on Bug itself. This is by design (avoids the prescriptive nature of `extends`), but some consumers will need to build an index.

### Open questions

- **Polymorphic associations**: A `Comment` that can belong to either a `Post` or a `Video` (distinguished by `commentable_type`) is polymorphism on the *relation*, not the model. The `relations` section would need to express "this relation can point to one of several models." Not yet designed.
- **ORM surface**: Does the ORM present separate collections for each variant (`db.bugs`, `db.features`) or only the base (`db.tasks`, returning a union)? This is an ORM design decision the contract doesn't prescribe.
- **Multi-level polymorphism**: What if Bug has its own sub-variants with a different discriminator field? Possible but adds complexity. Not yet designed.

## Related

- [ADR 1 — Contract domain-storage separation](ADR%201%20-%20Contract%20domain-storage%20separation.md) — why `model.fields` carries `nullable` and `codecId`
- [ADR 3 — Aggregate roots and relation strategies](ADR%203%20-%20Aggregate%20roots%20and%20relation%20strategies.md) — `roots`, `reference` vs `embed`
- [design-questions.md § DQ #6](../1-design-docs/design-questions.md)
- [cross-cutting-learnings.md § learning #4](../cross-cutting-learnings.md)
