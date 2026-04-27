# @prisma-next/mongo-codec

Codec interface and registry for MongoDB value serialization.

## Responsibilities

- **Codec interface**: `MongoCodec<Id, TTraits, TWire, TInput, TOutput = TInput>` — declares how a JS value translates to and from the BSON-shaped wire format the Mongo driver exchanges, plus the JSON-safe form stored in contract artifacts. Carries trait annotations (`equality`, `order`, `boolean`, `numeric`, `textual`, `vector`) for operator gating.
- **Codec factory**: `mongoCodec()` — creates frozen codec instances from a config object. `encode` is optional (identity default when omitted); `encode`/`decode` may be authored as sync or async functions and are lifted to Promise-returning query-time methods automatically. Build-time methods (`encodeJson`, `decodeJson`) are synchronous and default to identity when omitted.
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

See [ADR 204 — Single-Path Async Codec Runtime](../../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md) for the codec runtime's async boundary contract.

## Dependencies

- **Depends on**: nothing (leaf package)
- **Depended on by**:
  - `@prisma-next/adapter-mongo` (registers concrete codec implementations)
