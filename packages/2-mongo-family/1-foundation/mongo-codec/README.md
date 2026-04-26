# @prisma-next/mongo-codec

Codec interface and registry for MongoDB value serialization.

## Responsibilities

- **Codec interface**: `MongoCodec<Id, TTraits, TWire, TInput, TOutput = TInput>` — defines encode/decode between wire (BSON) and JS representations, with trait annotations (`equality`, `order`, `boolean`, `numeric`, `textual`, `vector`). The 5-generic shape is structurally identical to the SQL family's `Codec`, so a single codec definition can be registered in both family registries (cross-family parity).
- **Codec factory**: `mongoCodec()` — creates frozen codec instances from a config object
- **Codec registry**: `MongoCodecRegistry` and `createMongoCodecRegistry()` — a map-based container that stores and retrieves codecs by ID, with duplicate-ID protection
- **Type-level helpers**: `MongoCodecInput<T>`, `MongoCodecOutput<T>`, and `MongoCodecTraits<T>` for extracting input/output JS types and traits from codec types

## Dependencies

- **Depends on**: nothing (leaf package)
- **Depended on by**:
  - `@prisma-next/adapter-mongo` (registers concrete codec implementations)
