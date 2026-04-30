# @prisma-next/mongo-codec

Codec interface and registry for MongoDB value serialization.

## Responsibilities

- **Codec interface**: `MongoCodec<Id, TTraits, TWire, TInput>` — declares how a JS value translates to and from the BSON-shaped wire format the Mongo driver exchanges, plus the JSON-safe form stored in contract artifacts. Carries trait annotations (`equality`, `order`, `boolean`, `numeric`, `textual`, `vector`) for operator gating. Same four generics as the framework `Codec` base.
- **Codec factory**: `mongoCodec()` — creates frozen codec instances from a config object. `encode` is optional (identity default when omitted); `encode`/`decode` may be authored as sync or async functions and are lifted to Promise-returning query-time methods automatically. Build-time methods (`encodeJson`, `decodeJson`) are synchronous and default to identity when omitted.
- **Codec registry**: `MongoCodecRegistry` and `createMongoCodecRegistry()` — a map-based container that stores and retrieves codecs by ID, with duplicate-ID protection
- **Type-level helpers**: `MongoCodecInput<T>` and `MongoCodecTraits<T>` for extracting the input JS type and traits from codec types

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

### Codec call context (`ctx`)

Codec authors may optionally take a second `ctx?: CodecCallContext` argument on `encode`. The Mongo runtime threads one context per `mongoRuntime.execute(plan, { signal })` call. Mongo uses the framework `CodecCallContext` directly (signal-only); column metadata is SQL-family-specific and isn't part of Mongo's per-call shape today.

```ts
// Forward ctx.signal to a network SDK so aborted queries stop the round-trip.
const kmsSecretCodec = mongoCodec({
  typeId: 'mongo/kms-secret@1',
  targetTypes: ['string'],
  encode: async (v: string, ctx) =>
    kms.encrypt({ plaintext: v }, { signal: ctx?.signal }),
  decode: async (w: string, ctx) =>
    kms.decrypt({ ciphertext: w }, { signal: ctx?.signal }),
  encodeJson: (v: string) => v,
  decodeJson: (j: string) => j,
});
```

> **Note.** Mongo's read path doesn't go through `codec.decode` (per ADR 204 cross-family scope notes), so the `decode` signature above accepts `ctx` for parity with the codec interface but the runtime doesn't currently invoke `decode` on the Mongo read side. Encode-side `ctx.signal` is observed at every recursion level of `resolveValue` so a mid-encode abort surfaces as `RUNTIME.ABORTED { phase: 'encode' }`.

Existing single-arg authors (e.g. `(v: string) => v`) continue to compile and run unchanged. Aborts surface to the caller as `RUNTIME.ABORTED`; codec bodies that ignore the signal complete in the background (cooperative cancellation).

See [ADR 204 — Single-Path Async Codec Runtime](../../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md) for the codec runtime's async boundary contract, and [ADR 207 — Codec call context: per-query `AbortSignal` and column metadata](../../../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md) for the per-call context shape.

## Dependencies

- **Depends on**: nothing (leaf package)
- **Depended on by**:
  - `@prisma-next/adapter-mongo` (registers concrete codec implementations)
