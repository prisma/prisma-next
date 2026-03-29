# MongoContract / SqlContract: Convergence and Divergence

This document records where Mongo and SQL contract types follow the same structural pattern and where they intentionally diverge, informed by the M2 implementation and the contract redesign proposal.

## Why the contracts diverge

The fundamental difference: **in SQL, the database schema is the source of truth for data structure; in Mongo, the application's domain models are.**

In SQL, tables and columns exist independently of the application. The contract's storage layer describes what the database enforces. The model layer maps onto that schema — model fields indirect through column names because the column is the real thing.

In Mongo, there is no enforced schema. A collection is just a name with metadata. The document structure exists only because the application writes it that way. Model fields carry `codecId` directly — there's no underlying column to indirect through.

## Contract redesign: domain/storage separation

The contract redesign proposal resolves most of the divergence by separating domain from persistence. The domain-level structure (`roots`, `models`, `relations`, `discriminator`, `variants`) is **identical** between families. The divergence is scoped entirely to `model.storage` — the family-specific bridge from domain fields to persistence.

See [cross-cutting-learnings.md](../cross-cutting-learnings.md) for the full design principles and proposal.

## Convergence (family-agnostic)

These elements are identical between SQL and Mongo:

| Element | Description |
|---|---|
| **`roots`** | Maps ORM accessor names to model names. Same structure in both families. |
| **`model.fields`** | Array of field name strings. The domain vocabulary. |
| **`discriminator` + `variants`** | Polymorphism declaration. Same structure in both families. |
| **`model.relations`** | Connections to other models with cardinality and strategy. |
| **Variant models as siblings** | Base models, variants, and embedded models all appear as top-level `models` entries. |
| **TypeMaps phantom key** | `ContractWithTypeMaps<C, T>` / `MongoContractWithTypeMaps<C, T>` |
| **Codec abstractions** | Registry interface is family-agnostic; codecs themselves are family-specific. |
| **Codec ownership** | Concrete codecs in target adapter (`adapter-postgres` / `adapter-mongo`). |

## Divergence (scoped to `model.storage`)

The only structural divergence is inside `model.storage.fields` — the family-specific bridge:

| Aspect | SQL | Mongo | Rationale |
|---|---|---|---|
| **Field mapping** | `{ "column": "id" }` — field name → column name | `{ "codecId": "mongo/objectId@1" }` — field name → codec info | SQL has a storage schema to indirect through; Mongo doesn't |
| **Type info location** | On the storage column (`storage.tables[t].columns[c].codecId`) | On the model's storage field mapping (`model.storage.fields[f].codecId`) | SQL's source of truth is the database; Mongo's is the model |
| **`nullable`** | On the storage column | On the model's storage field mapping | Same rationale as type info |
| **Top-level `storage` detail** | Rich: tables, columns, native types, defaults, constraints, indexes, foreign keys | Sparse: collections with metadata (indexes, validators) | SQL storage describes what the database enforces; Mongo collections hold orthogonal config |

## Toward a shared contract base

The contract redesign demonstrates that a shared base IS viable — at the domain level. The `roots`, `models` (with `fields`, `discriminator`, `variants`), and `relations` sections are structurally identical between families. Only `model.storage` differs, and it's scoped.

A shared `ContractBase` should capture the domain-level structure and leave `model.storage` as a family-specific extension point. This is not a mechanical extraction from either `SqlContract` or `MongoContract` — it's a new abstraction rooted in domain modeling concepts (aggregate roots, entities, value types, references) that both families implement.

The domain model's four building blocks map to contract structure:

| Concept | Contract representation |
|---|---|
| **Aggregate root** | Entry in `roots`, model with `storage` containing table/collection |
| **Entity** | Entry in `models` with `fields` and `relations` |
| **Value type** | Entry in `types`/`composites` (not yet designed) |
| **Reference** | Relation with `"strategy": "reference"` |
| **Embedding** | Relation with `"strategy": "embed"` |
| **Polymorphism** | `discriminator` + `variants` on any model |
