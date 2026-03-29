# ADR 1 — Contract domain-storage separation

> **Scope**: Mongo-target local ADR. Will be promoted to the repo-wide ADR directory when the contract redesign is implemented across both families.

## At a glance

A User model in both families, showing the domain/storage separation. Note how `name` maps to a different column (`display_name`) in SQL — this is why SQL needs field-to-column mappings. Mongo doesn't have this indirection, so its storage block is just the collection name.

**SQL contract:**
```json
{
  "roots": { "users": "User" },
  "models": {
    "User": {
      "fields": {
        "id": { "nullable": false, "codecId": "pg/int4@1" },
        "email": { "nullable": false, "codecId": "pg/text@1" },
        "name": { "nullable": true, "codecId": "pg/text@1" }
      },
      "relations": {},
      "storage": {
        "table": "users",
        "fields": {
          "id": { "column": "id" },
          "email": { "column": "email" },
          "name": { "column": "display_name" }
        }
      }
    }
  }
}
```

**Mongo contract (same domain, different storage):**
```json
{
  "roots": { "users": "User" },
  "models": {
    "User": {
      "fields": {
        "id": { "nullable": false, "codecId": "mongo/objectId@1" },
        "email": { "nullable": false, "codecId": "mongo/string@1" },
        "name": { "nullable": true, "codecId": "mongo/string@1" }
      },
      "relations": {},
      "storage": {
        "collection": "users"
      }
    }
  }
}
```

The domain sections (`roots`, `fields`, `relations`) have the same structure — same TypeScript type across families. The `codecId` values differ (`pg/text@1` vs `mongo/string@1`), but that's values, not structure. Only `storage` differs structurally, and for Mongo it's minimal.

## Context

The Prisma Next contract is a JSON document that describes an application's data model and its persistence. Before this decision, the SQL contract mixed domain and storage concerns in a single `fields` block:

```json
{
  "User": {
    "fields": {
      "email": { "column": "email", "codecId": "pg/text@1" }
    },
    "storage": { "table": "users" }
  }
}
```

Each field carried both its column mapping (a storage concern) and its type (a domain concern). This worked for SQL alone, but when we built the Mongo contract (M2 of the Mongo PoC), the structures couldn't converge:

- **SQL** has column indirection: the database schema defines tables and columns independently of the application. A field named `name` might map to a column called `display_name`. The contract needs to track both.
- **Mongo** has no column indirection: there's no enforced database schema. Document fields are whatever the application writes. There's nothing to indirect through.

We originally planned to keep `MongoContract` structurally parallel to `SqlContract` so extracting a shared base would be mechanical. The M2 implementation proved this isn't feasible — a mechanical extraction either produces something too loose to be useful, or forces one family into the other's shape.

## Problem

We need a contract structure that:

1. Supports both SQL and Mongo (and potentially future families) with a shared base
2. Keeps domain-level information (what the application models) readable independently of storage details
3. Preserves co-location of related information so the JSON isn't fragile
4. Doesn't force either family into the other's structural patterns

## Constraints

- **Co-location matters for SQL.** Field-to-column mappings need their table context nearby. If the table name is in a different section (e.g., a top-level `roots` entry), column references are left dangling — a reader or tool has to cross-reference a different section to understand what table those columns belong to.

- **Mongo has no column indirection.** Any structure that forces Mongo to mirror SQL's field → column → codec chain adds meaningless indirection.

- **The contract is emitted, not hand-written.** The emitter guarantees consistency, so redundancy (e.g., field names appearing in both `model.fields` and `model.storage.fields`) is acceptable. The cost is readability and JSON size, not correctness.

- **Machine-readability is a first-class goal.** The contract is designed to be read by agents, consumer libraries, and tooling. A consumer should be able to extract the domain model without understanding family-specific storage details.

## Decision

Separate the contract into a domain level (family-agnostic) and a storage level (family-specific), with `model.storage` as a scoped bridge between them. Refer to the [At a glance](#at-a-glance) example throughout — it shows the complete structure.

### The domain level is self-describing

Each model's domain section should give a reader a complete picture of the field — its name, its type, its nullability — without consulting the storage block. This is why `model.fields` is a record carrying `{ nullable: boolean, codecId: string }` rather than a bare string array.

**`nullable`** is a domain concept: "can a User have no email?" is a business rule that directly affects the TypeScript types the ORM infers (`string` vs `string | null`). Both families need it identically. `nullable` is always an explicit `boolean` (never omitted, never inferred from a default) so the contract is self-describing — a reader doesn't need to know "what's the default?" to understand a field. This also makes contract diffs clearer: `false → true`, not `undefined → true`.

**`codecId`** identifies a field's type. Describing a field without its type leaves the domain section incomplete. The codec identifier is the framework's way of expressing a field's type, and as a concept it is family-agnostic: every family uses codec identifiers, the identifier format is universal, and any consumer can read one without understanding the family's storage model. A Mongo contract's field says `"mongo/string@1"` and an SQL contract's says `"pg/text@1"` for the same domain concept — the *values* differ, but the *structure* is identical. **"Family-agnostic" describes the structure of the domain section, not its values.** The specific codec IDs *available* depend on framework composition (which families, targets, and extensions are loaded), but that is a composition concern, not a structural one.

### The storage level is scoped and family-specific

`model.storage` sits on the model (not in a separate section) to preserve co-location. In SQL, field-to-column mappings like `"name": { "column": "display_name" }` need their table context nearby — separating them would leave column references dangling. For a consumer that only cares about the domain, `model.storage` is a clearly scoped block to skip. The separation is logical, not physical.

The families diverge only in what `model.storage` contains:

- **SQL**: table name + field-to-column mappings, because SQL has genuine field-name-to-column-name indirection.
- **Mongo**: collection name only. No field mappings needed — the domain fields map directly to document fields. However, `model.storage.fields` is available to Mongo should field name remapping ever be needed (e.g., mapping a domain field `createdAt` to a document field `_created_at`).

This divergence is honest — it reflects a real structural difference between the families (column indirection), not an artifact of where we put the codec.

A top-level `storage` section (separate from `model.storage`) describes the database schema independently: SQL tables with columns, native types, defaults, constraints, indexes, and foreign keys; Mongo collections with metadata like indexes and validators.

### Other domain-level properties

- **`model.relations`** — connections to other models with cardinality and strategy (see [ADR 3](ADR%203%20-%20Aggregate%20roots%20and%20relation%20strategies.md)).
- **`model.discriminator`** + **`model.variants`** — optional polymorphism declaration (see [ADR 2](ADR%202%20-%20Polymorphism%20via%20discriminator%20and%20variants.md)).

## Consequences

### Benefits

- **Shared contract base is viable.** The domain level (`roots`, `models` with `fields`/`discriminator`/`variants`, `relations`) is structurally identical between families. A `ContractBase` type can capture this, with `model.storage` as a generic/family-specific extension point.
- **Consumer libraries can be family-agnostic** for domain-level operations (listing models, traversing relations, finding aggregate roots).
- **Each family controls its own storage representation** without compromising the other.
- **The storage divergence is narrower.** Moving `codecId` to the domain level means Mongo's `model.storage` is just a collection name. The remaining divergence (SQL's field-to-column mappings) reflects a genuine structural difference.

### Costs

- **Redundancy.** In SQL, field names appear in both `model.fields` and `model.storage.fields`. Acceptable for an emitted artifact.
- **Codec IDs in the domain section contain family-specific prefixes** (e.g. `mongo/`, `pg/`). A consumer reading just the domain section sees which family the contract is for. This is a minor information leak, but it doesn't affect structure — the domain section's TypeScript type is identical across families.

### What this requires

- Both `SqlContract` and `MongoContract` will need to be modified to adopt this structure.
- The emitter must be updated to produce the new format.
- Consumer libraries that read the contract will need to be updated.
- The `ContractBase` type must be designed as a new abstraction, not extracted mechanically from either existing contract.

## Related

- [ADR 2 — Polymorphism via discriminator and variants](ADR%202%20-%20Polymorphism%20via%20discriminator%20and%20variants.md)
- [ADR 3 — Aggregate roots and relation strategies](ADR%203%20-%20Aggregate%20roots%20and%20relation%20strategies.md)
- [contract-symmetry.md](../1-design-docs/contract-symmetry.md) — convergence/divergence analysis
- [cross-cutting-learnings.md](../cross-cutting-learnings.md) — design principles and open questions
