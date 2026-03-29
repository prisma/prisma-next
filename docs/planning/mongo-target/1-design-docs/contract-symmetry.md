# MongoContract / SqlContract: Convergence and Divergence

This document records where Mongo and SQL contract types follow the same
structural pattern and where they intentionally diverge.

## Why the contracts diverge

The fundamental difference: **in SQL, the database schema is the source of truth for data structure; in Mongo, the application's domain models are.**

In SQL, tables and columns exist independently of the application. The contract's storage layer (tables, columns, native types, constraints) describes what the database enforces. The model layer is a mapping *onto* that schema — model fields indirect through column names because the column is the real thing, and the model field is a name the application gave it.

In Mongo, there is no enforced schema. A collection is just a name with some metadata (indexes, validators). The document structure exists only because the application writes it that way. The model layer IS the schema — model fields carry `codecId` and `nullable` directly because there's no underlying column to indirect through.

This showed up concretely in the M2 implementation: `MongoStorageCollection` ended up as an empty type. All field information migrated to the model layer. Mirroring SQL's column indirection pattern would cause massive duplication in the 99% case where a Mongo model's fields are identical to the document's fields.

## Convergence

Both domains share these structural patterns:

| Pattern | SQL | Mongo |
|---|---|---|
| **Top-level contract** | `SqlContract<S,M,R,Map>` | `MongoContract<S,M,R,Map>` |
| **Storage container** | `SqlStorage.tables: Record<string, StorageTable>` | `MongoStorage.collections: Record<string, MongoStorageCollection>` |
| **Model definition** | `ModelDefinition` with `storage`, `fields`, `relations` | `MongoModelDefinition` with `storage`, `fields`, `relations` |
| **Model → storage link** | `ModelDefinition.storage.table: string` | `MongoModelDefinition.storage.collection: string` |
| **Mappings** | `SqlMappings` with `modelToTable`, `tableToModel` | `MongoMappings` with `modelToCollection`, `collectionToModel` |
| **TypeMaps phantom key** | `ContractWithTypeMaps<C, T>` | `MongoContractWithTypeMaps<C, T>` |
| **Type extraction** | `ExtractCodecTypes<T>` | `ExtractMongoCodecTypes<T>` |
| **Codec abstractions** | `Codec` interface, `codec()` factory, `CodecRegistry` | `MongoCodec` interface, `mongoCodec()` factory, `MongoCodecRegistry` |
| **Codec ownership** | Concrete codecs in adapter (`adapter-postgres`) | Concrete codecs in adapter (`adapter-mongo`) |
| **Codec ID constants** | `PG_*_CODEC_ID` in adapter | `MONGO_*_CODEC_ID` in adapter |
| **Target pack** | `@prisma-next/target-postgres` | `@prisma-next/target-mongo` |

## Divergence

| Aspect | SQL | Mongo | Rationale |
|---|---|---|---|
| **Field location** | Storage columns carry `codecId`, `nativeType`, `nullable`; model fields indirect via column name | Model fields carry `codecId` and `nullable` directly | The model IS the schema in Mongo — there's no underlying column to indirect through |
| **Storage detail** | `StorageTable.columns: Record<string, StorageColumn>` with full column metadata | `MongoStorageCollection: {}` (empty for PoC) | SQL storage describes what the database enforces; Mongo storage describes collection-level config (indexes, validators) that is orthogonal to document structure |
| **Field-level mappings** | `SqlMappings.fieldToColumn`, `columnToField` | Not present | Model field names ARE the document field names |
| **Inference chain** | `model field → column name → storage column → codecId → CodecTypes` | `model field → codecId → CodecTypes` | One fewer hop because there is no column indirection |
| **Contract base** | Extends `ContractBase` | Independent type | See "Toward a shared contract base" below |
| **TypeMaps breadth** | `{ codecTypes, operationTypes, queryOperationTypes }` | `{ codecTypes }` only | Mongo PoC only needs codec types for now |

## Toward a shared contract base

The original plan was to keep `MongoContract` structurally parallel to `SqlContract` so extraction of a shared base would be mechanical. The M2 implementation proved this isn't feasible — the shapes diverged meaningfully because the two families have different sources of truth for data structure.

A mechanical extraction would produce something either too loose to be useful or that forces one family into the other's shape. Instead, a shared contract base should be designed as a **new abstraction** informed by both implementations — one that will likely require modifying both `SqlContract` and `MongoContract` to fit.

The parallel structure (both have `storage`, `models`, `relations`, `mappings`, `TypeMaps` phantom key) suggests a shared base is viable at the outer structural level. But field-level semantics must remain family-specific.

See [cross-cutting-learnings.md](../cross-cutting-learnings.md) for the broader domain modeling concepts (aggregate roots, entities, value types, references) that should inform the shared contract base design.
