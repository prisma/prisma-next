# MongoContract / SqlContract: Convergence and Divergence

This document records where Mongo and SQL contract types follow the same
structural pattern and where they intentionally diverge.

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
| **Field location** | Storage columns carry `codecId`, `nativeType`, `nullable`; model fields indirect via column name | Model fields carry `codecId` and `nullable` directly | Mongo has no enforced schema; the model IS the schema |
| **Storage detail** | `StorageTable.columns: Record<string, StorageColumn>` with full column metadata | `MongoStorageCollection: {}` (empty for PoC) | Column metadata is essential in SQL; in Mongo, collection-level config (indexes, validators) is orthogonal to field definitions |
| **Field-level mappings** | `SqlMappings.fieldToColumn`, `columnToField` | Not present | Model field names ARE the document field names |
| **Inference chain** | `model field → column name → storage column → codecId → CodecTypes` | `model field → codecId → CodecTypes` | One fewer hop because there is no column indirection |
| **Contract base** | Extends `ContractBase` | Independent type | Mongo doesn't need `ContractBase`; a shared base should be designed as a new abstraction later |
| **TypeMaps breadth** | `{ codecTypes, operationTypes, queryOperationTypes }` | `{ codecTypes }` only | Mongo PoC only needs codec types for now |

## Recommendation for shared ContractBase

The parallel structure (both have `storage`, `models`, `relations`, `mappings`,
`TypeMaps` phantom key) suggests a shared base is viable. However:

1. Forcing SQL's field-to-column indirection onto Mongo would add complexity
   without value.
2. A useful shared base should capture what's _genuinely common_ (the outer
   shape: storage, models, relations, mappings, TypeMaps) while letting each
   domain define field/column semantics independently.
3. This extraction should happen when we have a third domain or a clear
   cross-domain consumer, not preemptively.

**Next step**: When the need arises, define `ContractBase<S, M, R, Map>` as a
structural supertype that both `SqlContract` and `MongoContract` extend, without
requiring field-level alignment.
