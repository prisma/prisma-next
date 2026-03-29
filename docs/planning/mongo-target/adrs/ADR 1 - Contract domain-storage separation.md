# ADR 1 — Contract domain-storage separation

> **Scope**: Mongo-target local ADR. Will be promoted to the repo-wide ADR directory when the contract redesign is implemented across both families.

## Context

The Prisma Next contract is a JSON document that describes an application's data model and its persistence. Before this decision, the SQL contract mixed domain and storage concerns: `model.fields` contained both the field name and its column mapping (`"email": { "column": "email" }`), and the model's `storage` block contained only the table name.

When we built the Mongo contract (M2 of the Mongo PoC), we discovered that SQL and Mongo contracts diverge in how they store field information:

- **SQL**: `model field → column name → storage column → codecId → CodecTypes` (3 hops, column indirection). The source of truth for data structure is the database schema — tables and columns exist independently of the application.
- **Mongo**: `model field → codecId → CodecTypes` (2 hops, no indirection). The source of truth is the application's domain models — there is no enforced database schema.

The original plan was to keep `MongoContract` structurally parallel to `SqlContract` so extraction of a shared base would be mechanical. The M2 implementation proved this is not feasible. A mechanical extraction produces either something too loose to be useful, or something that forces one family into the other's shape.

## Problem

We need a contract structure that:

1. Supports both SQL and Mongo (and potentially future families) with a shared base
2. Keeps domain-level information (what the application models) readable independently of storage details
3. Preserves co-location of related information so the JSON isn't fragile
4. Doesn't force either family into the other's structural patterns

## Constraints

- **Co-location matters for SQL.** In the SQL contract, field-to-column mappings need their table context nearby. If we move the table name to a different section (e.g., a top-level `roots` entry), column references are left dangling — a reader or tool has to cross-reference a different section to understand what table those columns belong to. This was discovered when we considered moving `storage` off the model and onto a `roots` entry.

- **Mongo has no column indirection.** In Mongo, model fields carry `codecId` directly because the model IS the schema. There is no underlying column to indirect through. Any structure that forces Mongo to mirror SQL's field → column → codec chain adds meaningless indirection.

- **The contract is emitted, not hand-written.** The emitter guarantees consistency, so redundancy in the contract JSON is acceptable (e.g., a field appearing both in `model.fields` and in `model.storage.fields`). The cost of redundancy is in readability and JSON size, not correctness.

- **Machine-readability is a first-class goal.** The contract is designed to be read by agents, consumer libraries, and tooling. A consumer should be able to extract the domain model without understanding family-specific storage details.

## Decision

Separate the contract into domain-level structure (family-agnostic) and storage-level details (family-specific), with `model.storage` as the scoped bridge between them.

### Domain level (family-agnostic)

- **`model.fields`** — an array of field name strings. This is the domain vocabulary: the names the application uses for this model's data. No type info, no storage mapping, just names. Variant models list only their own additional fields (inherited fields come from the base model via the `variants` relationship).
- **`model.relations`** — connections to other models (cardinality, strategy).
- **`model.discriminator`** + **`model.variants`** — optional polymorphism declaration (see ADR 2).

### Storage level (family-specific)

- **`model.storage`** — the bridge from domain fields to their persistence. Contains the storage unit name (table or collection) and a `fields` map with family-specific details.
- **Top-level `storage`** — describes the database schema independently of the domain model. SQL: tables, columns (with `codecId`, native types, defaults, constraints), indexes, foreign keys. Mongo: collections with metadata (indexes, validators).

### `model.storage.fields` — the divergence point

This is the only structural divergence between families:

**SQL:**
```json
{
  "storage": {
    "table": "users",
    "fields": {
      "id": { "column": "id" },
      "email": { "column": "email" }
    }
  }
}
```
Field → column name. Codec/type info lives on `storage.tables[table].columns[column]`.

**Mongo:**
```json
{
  "storage": {
    "collection": "users",
    "fields": {
      "_id": { "codecId": "mongo/objectId@1" },
      "email": { "codecId": "mongo/string@1" }
    }
  }
}
```
Field → codec info directly. No column indirection because the model IS the schema.

### Why `model.fields` as a string array, not objects

We considered making fields objects (carrying `type`, `nullable`, etc.), which would add domain richness. We chose strings because:

1. **Most of the content is family-specific.** In SQL, the interesting field metadata (codec, nullability, native type) lives on the storage column, not the model field. In Mongo, codec and nullability live on `model.storage.fields`. Making `model.fields` carry this info would either duplicate it or move it to a family-agnostic location where it doesn't cleanly fit both shapes.
2. **String arrays are a clean common interface.** The `model.fields` list answers "what does this model contain?" and nothing else. Any consumer can enumerate a model's domain fields without parsing family-specific structures.
3. **Redundancy between `model.fields` and `model.storage.fields` is tolerable** because the contract is emitted (the emitter guarantees consistency), and the two sections serve different readers: domain-level consumers read `fields`, storage-level consumers read `storage.fields`.

The main cost is that field-level domain metadata (most notably nullability) has no family-agnostic home. See [open question: `nullable` location](../cross-cutting-learnings.md).

### Why `model.storage` stays on the model

We considered moving storage to a top-level `roots` section. This would cleanly separate domain from persistence at the JSON structure level. We rejected it because:

1. **SQL field-to-column mappings need table context.** If the table name is on a `roots` entry and the columns are on the model, a reader has to cross-reference two sections. This makes the JSON fragile and harder to read.
2. **Co-location preserves locality of reasoning.** When reading a model, you can see both its domain fields and its storage mapping in one place. This is especially important for SQL, where the column names often differ from the field names (e.g., `assigneeId` → `assignee_id`).
3. **Scoping keeps the separation clean enough.** `model.storage` is clearly marked as the family-specific block. A consumer that only cares about the domain can skip it. The separation is logical, not physical.

## Consequences

### Benefits

- **Shared contract base is viable.** The domain level (`roots`, `models` with `fields`/`discriminator`/`variants`, `relations`) is structurally identical between families. A `ContractBase` type can capture this, with `model.storage` as a generic/family-specific extension point.
- **Consumer libraries can be family-agnostic** for domain-level operations (listing models, traversing relations, finding aggregate roots).
- **Each family controls its own storage representation** without compromising the other.

### Costs

- **Redundancy.** Field names appear in both `model.fields` and `model.storage.fields`. Acceptable for an emitted artifact.
- **Field metadata is split.** Domain-level field info (currently just the name) is in `model.fields`; storage-level field info is in `model.storage.fields`. A consumer that needs both must read both.
- **`nullable` has no clear home.** Whether nullability is a domain concept or a storage concept is unresolved.

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
