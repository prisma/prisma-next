# @prisma-next/mongo-codec

Codec interface and registry for MongoDB value serialization.

## Responsibilities

- **Codec interface**: `MongoCodec<Id, TTraits, TWire, TJs>` — defines encode/decode between wire (BSON) and JS representations, with trait annotations (`equality`, `order`, `boolean`, `numeric`, `textual`, `vector`)
- **Codec factory**: `mongoCodec()` — creates frozen codec instances from a config object
- **Codec registry**: `MongoCodecRegistry` and `createMongoCodecRegistry()` — a map-based container that stores and retrieves codecs by ID, with duplicate-ID protection
- **Type-level helpers**: `MongoCodecJsType<T>` and `MongoCodecTraits<T>` for extracting JS types and traits from codec types

## Dependencies

- **Depends on**: nothing (leaf package)
- **Depended on by**:
  - `@prisma-next/adapter-mongo` (registers concrete codec implementations)
