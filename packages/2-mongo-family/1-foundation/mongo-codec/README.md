# @prisma-next/mongo-codec

Codec interface and registry for MongoDB value serialization.

## Responsibilities

- **Codec interface**: `MongoCodec<Id, TTraits, TWire, TInput, TOutput = TInput>` — defines encode/decode between wire (BSON) and JS representations, with trait annotations (`equality`, `order`, `boolean`, `numeric`, `textual`, `vector`). The 5-generic shape is structurally identical to the SQL family's `Codec`, so a single codec definition can be registered in both family registries (cross-family parity).
- **Codec factory**: `mongoCodec()` — creates frozen codec instances from a config object. Accepts `encode` and `decode` author functions in **either sync or async form**; the constructed codec exposes Promise-returning query-time methods regardless of which form was used. Build-time methods (`encodeJson`, `decodeJson`) are synchronous.
- **Codec registry**: `MongoCodecRegistry` and `createMongoCodecRegistry()` — a map-based container that stores and retrieves codecs by ID, with duplicate-ID protection
- **Type-level helpers**: `MongoCodecInput<T>`, `MongoCodecOutput<T>`, and `MongoCodecTraits<T>` for extracting input/output JS types and traits from codec types

## Examples

```ts
// Sync authoring:
const intCodec = mongoCodec({
  typeId: 'mongo/int@1',
  targetTypes: ['int'],
  encode: (v: number) => v,
  decode: (w: number) => w,
  encodeJson: (v: number) => v,
  decodeJson: (j: number) => j,
});

// Async authoring (e.g. KMS-backed encryption): same factory, same shape.
const secretCodec = mongoCodec({
  typeId: 'mongo/secret@1',
  targetTypes: ['string'],
  encode: async (v: string) => encrypt(v, await getKey()),
  decode: async (w: string) => decrypt(w, await getKey()),
  encodeJson: (v: string) => v,
  decodeJson: (j: string) => j,
});
```

A single `mongoCodec({...})` value is structurally usable in both Mongo and SQL runtimes (same five-generic shape, same Promise-returning query-time methods, same synchronous build-time methods). See [ADR 204 — Single-Path Async Codec Runtime](../../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md) for the cross-family parity story and the full design.

## Dependencies

- **Depends on**: nothing (leaf package)
- **Depended on by**:
  - `@prisma-next/adapter-mongo` (registers concrete codec implementations)
