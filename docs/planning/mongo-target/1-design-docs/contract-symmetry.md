# MongoContract / SqlContract: Convergence and Divergence

This document records where Mongo and SQL contract types follow the same structural pattern and where they intentionally diverge, informed by the M2 implementation and the contract redesign proposal.

## Why the contracts diverge

The fundamental difference: **in SQL, the database schema is the source of truth for data structure; in Mongo, the application's domain models are.**

In SQL, tables and columns exist independently of the application. The contract's storage layer describes what the database enforces. The model layer maps onto that schema — model fields indirect through column names because the column is the real thing.

In Mongo, there is no enforced schema. A collection is just a name with metadata. The document structure exists only because the application writes it that way. Model fields carry `codecId` directly — there's no underlying column to indirect through.

## Contract redesign: domain/storage separation

The contract redesign proposal resolves most of the divergence by separating domain from persistence. The domain-level structure (`roots`, `models`, `relations`, `discriminator`, `variants`) is **structurally identical** between families — same TypeScript type, though values like `codecId` differ per family. The divergence is scoped entirely to `model.storage` — the family-specific bridge from domain fields to persistence.

See [cross-cutting-learnings.md](../cross-cutting-learnings.md) for the full design principles and proposal.

## Convergence (family-agnostic)

These elements are identical between SQL and Mongo:

| Element | Description |
|---|---|
| **`roots`** | Maps ORM accessor names to model names. Same structure in both families. |
| **`model.fields`** | Record mapping field names to `{ nullable: boolean, codecId: string }`. Keys are the domain vocabulary. Values differ per contract but the structure is identical. |
| **`codecId`** | Field type identifier on `model.fields[f].codecId`. The concept is family-agnostic; available IDs depend on framework composition. |
| **`nullable`** | Domain-level field metadata (`model.fields[f].nullable`). Non-optional boolean. |
| **`discriminator` + `variants` + `base`** | Polymorphism declaration. Base model lists specializations (`variants`); each variant names its generalization (`base`). Bidirectional, same structure in both families. |
| **`model.relations`** | Connections to other models with cardinality and strategy. |
| **Variant models as siblings** | Base models, variants, and embedded models all appear as top-level `models` entries. |
| **TypeMaps phantom key** | `ContractWithTypeMaps<C, T>` / `MongoContractWithTypeMaps<C, T>` |
| **Codec abstractions** | Registry interface is family-agnostic; codecs themselves are family-specific. |
| **Codec ownership** | Concrete codecs in target adapter (`adapter-postgres` / `adapter-mongo`). |

## Divergence (scoped to `model.storage`)

The divergence is scoped to `model.storage` — and it's narrow. With `codecId` on the domain field, the divergence reflects a genuine structural difference: SQL has field-to-column indirection, Mongo doesn't.

| Aspect | SQL | Mongo | Rationale |
|---|---|---|---|
| **`model.storage.fields`** | `{ "column": "id" }` — field name → column name | Not needed (no indirection) | SQL field names and column names can differ; Mongo's domain fields ARE the document fields |
| **`model.storage` overall** | `{ "table": "users", "fields": { ... } }` — table name + column mappings | `{ "collection": "users" }` — collection name only | SQL has a storage schema to indirect through; Mongo's model is the schema |
| **Top-level `storage` detail** | Rich: tables, columns, native types, defaults, constraints, indexes, foreign keys | Sparse: collections with metadata (indexes, validators) | SQL storage describes what the database enforces; Mongo collections hold orthogonal config |

## Validation

SQL's `validateContract<TContract>(json)` returns `TContract` directly. Mongo's `validateMongoContract<TContract>(json)` returns a `ValidatedMongoContract<TContract>` wrapper containing `{ contract, indices, warnings }`.

This is an intentional divergence:

| Aspect | SQL | Mongo | Rationale |
|---|---|---|---|
| **Return type** | `TContract` | `ValidatedMongoContract<TContract>` | Mongo needs computed indices |
| **Computed indices** | None | `variantToBase`, `modelToVariants` | Polymorphism requires reverse-lookup maps for runtime query dispatch |
| **Warnings** | Not returned | `warnings: string[]` | Domain validation produces non-fatal warnings (e.g. orphaned models) |

The Mongo wrapper exists because Mongo contracts carry richer structural metadata (polymorphism indices) that consumers need at runtime. If SQL adds polymorphism support via the same `discriminator`/`variants`/`base` primitives, it will likely need a similar wrapper. The domain validation layer (`validateContractDomain`) already produces warnings — SQL would need to surface them too.

## Toward a shared contract base

The contract redesign demonstrates that a shared base IS viable — at the domain level. The `roots`, `models` (with `fields` carrying `nullable` and `codecId`, `discriminator`/`variants`/`base`), and `relations` sections are structurally identical between families. Only `model.storage` differs, and it's scoped. For Mongo, `model.storage` is minimal (collection name only); for SQL, it carries field-to-column mappings. This remaining divergence is justified — it reflects a real structural difference between the families, not an arbitrary placement choice.

A shared `ContractBase` should capture the domain-level structure and leave `model.storage` as a family-specific extension point. This is not a mechanical extraction from either `SqlContract` or `MongoContract` — it's a new abstraction rooted in domain modeling concepts (aggregate roots, entities, value types, references) that both families implement.

The domain model's four building blocks map to contract structure:

| Concept | Contract representation |
|---|---|
| **Aggregate root** | Entry in `roots`, model with `storage` containing table/collection |
| **Entity** | Entry in `models` with `fields` and `relations` |
| **Value type** | Entry in `types`/`composites` (not yet designed) |
| **Reference** | Relation with `"strategy": "reference"` |
| **Embedding** | Relation with `"strategy": "embed"` |
| **Polymorphism** | `discriminator` + `variants` on base model; `base` on each variant (specialization/generalization) |
