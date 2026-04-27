closes [<TBD>](https://linear.app/prisma-company/issue/<TBD>/codec-async-single-path)

# single-path async codec runtime

## Grounding example

A user wants a `secret` column that's encrypted before insert and decrypted on read using a real async crypto API. They author a codec:

```ts
const secretCodec = codec({
  id: 'app/secret@1',
  encode: async (plain: string) => aesGcmEncrypt(plain, key),
  decode: async (cipher: Uint8Array) => aesGcmDecrypt(cipher, key),
  encodeJson: (value) => /* sync, build-time */ ...,
  decodeJson: (json) => /* sync, build-time */ ...,
});
```

They register it on a column. Their application code stays ordinary:

```ts
await users.create({ secret: 'hello' });
const row = await users.first({ where: { id } });
row.secret; // string — plain T, no Promise leaks into user code
```

This wasn't possible before: `Codec.encode` and `Codec.decode` were synchronous, and the runtime called them in tight `for` loops.

## Decision

Make `Codec.encode` and `Codec.decode` always return `Promise<T>` at the public boundary. The runtime always awaits them and dispatches per-row codec calls concurrently with `Promise.all`. Codec authors keep writing whichever shape is natural — sync or async — and the factory (`codec()` / `mongoCodec()`) lifts both uniformly. Build-time methods (`encodeJson`, `decodeJson`, optional `renderOutputType`) stay synchronous because they don't run per-row.

The canonical decision record is [ADR 204 — Single-Path Async Codec Runtime](docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md).

## Narrative

A codec author's natural unit of work is "encode this one value" or "decode this one cell". When that work is synchronous (e.g. a JSON serializer) authoring is simple; when it's asynchronous (crypto, network-backed redaction policy, contract-side computed defaults that consult IO) the author needs to `await` inside `encode` / `decode` without worrying whether the runtime knows what to do with the result.

Two shapes were on the table:

- **Per-codec sync/async marker**: every codec carries a `runtime: 'sync' | 'async'` discriminator on the public surface; every call site branches on it.
- **Always-async at the public boundary**: every `encode` / `decode` returns `Promise<T>`; the runtime always awaits.

We chose the second. The discriminator pushes complexity into every consumer of `Codec`: the runtime's per-row dispatcher, the SQL DSL's encode-once-per-statement path, the Mongo encode lowering, the ORM's row-yielding generator, and downstream tests. Each call site has to handle both shapes, usually via conditional return types and `instanceof Promise` guards. Always-async pushes the cost into one place — the factory, which lifts a sync author function to `async (x) => fn(x)` once. The runtime then has a single arm (`await codec.encode(...)`, `await codec.decode(...)`) and uses `Promise.all` to dispatch per-row work concurrently. From the user's point of view nothing changes: rows yielded by collections still hold plain `T`, and write inputs still accept plain `T`.

The `Codec` type also widens from 4 to 5 generics with a `TOutput = TInput` default. This makes the asymmetric `TInput ≠ TOutput` case expressible (e.g. a codec whose author-input is `Uint8Array` but whose ORM-decoded output is `Buffer`); existing 4-generic call sites keep working through the default.

The Mongo family aligns with the same shape. `MongoCodec` is structurally identical to the framework `BaseCodec` (5 generics, same order, same defaults), so a single `codec({...})` value works against both registries. `MongoAdapter.lower(plan)` becomes `Promise<AnyMongoWireCommand>` because lowering walks codecs as it produces the wire shape.

## Behavior changes & evidence

| Change | Before | After | Evidence |
|---|---|---|---|
| `Codec.encode` / `Codec.decode` | sync | `Promise<T>` at the public boundary | [framework-components/src/codec-types.ts (L27–L50)](packages/1-framework/1-core/framework-components/src/codec-types.ts); [type tests](packages/1-framework/1-core/framework-components/test/codec-types.types.test-d.ts) |
| `codec()` / `mongoCodec()` factory | sync-only authoring | accepts sync, async, or mixed; uniformly lifts to Promise-returning | [relational-core/src/ast/codec-types.ts (L207–L240)](packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts); [mongo-codec/src/codecs.ts (L56–L88)](packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts) |
| `Codec` generic count | 4 (`Id, TTraits, TWire, TJs`) | 5 (`Id, TTraits, TWire, TInput, TOutput=TInput`) | same file as above; `MongoCodec` widened to match in [mongo-codec/src/codecs.ts (L30–L36)](packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts) |
| SQL runtime dispatch | sync `for`-loop | always-await + `Promise.all` per encode/decode site | [encoding.ts (L78–L100)](packages/2-sql/5-runtime/src/codecs/encoding.ts), [decoding.ts (L210–L277)](packages/2-sql/5-runtime/src/codecs/decoding.ts); [codec-async.test.ts](packages/2-sql/5-runtime/test/codec-async.test.ts) |
| Error envelopes on encode/decode failure | raw thrown errors | `RUNTIME.ENCODE_FAILED` / `RUNTIME.DECODE_FAILED` with `cause` chaining; existing `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED` envelope re-raised verbatim when matched | [wrapEncodeFailure (L23–L38)](packages/2-sql/5-runtime/src/codecs/encoding.ts), [wrapDecodeFailure (L98–L118)](packages/2-sql/5-runtime/src/codecs/decoding.ts); envelope tests in [codec-async.test.ts (L143–L477)](packages/2-sql/5-runtime/test/codec-async.test.ts) |
| `MongoAdapter.lower(plan)` | sync | `Promise<AnyMongoWireCommand>` so adapters can run async codec encodes before producing the wire shape | [mongo-lowering/src/adapter-types.ts (L4–L6)](packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts); [adapter-mongo tests](packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts) |
| `resolveValue` (Mongo encode-side) | not the dispatch concentration site | `await codec.encode(...)` per `MongoParamRef` leaf; `Promise.all` over array elements and object children | [resolve-value.ts (L14–L44)](packages/3-mongo-target/2-mongo-adapter/src/resolve-value.ts); [resolve-value.test.ts (L82–L170)](packages/3-mongo-target/2-mongo-adapter/test/resolve-value.test.ts) |
| Cross-family `BaseCodec` seam | SQL `Codec` (5 gen) vs Mongo `MongoCodec` (4 gen) | both derive from `BaseCodec` with structurally-identical 5-generic shape | [cross-family-codec.test.ts](test/integration/test/cross-package/cross-family-codec.test.ts); [mongo-codec/test/codecs.test-d.ts (L65–L112)](packages/2-mongo-family/1-foundation/mongo-codec/test/codecs.test-d.ts) |
| Real AES-GCM crypto round-trip (security probe) | only synthetic `Promise.resolve(...)` codecs in tests | seeded-secret-codec fixture: real AES-GCM with deterministic test key, end-to-end through `encodeParams` and `decodeRow`, asserts no Promise leaks into yielded rows | [seeded-secret-codec.ts](packages/2-sql/5-runtime/test/seeded-secret-codec.ts); [codec-async.test.ts (L529–L620)](packages/2-sql/5-runtime/test/codec-async.test.ts) |

## What stays the same

- **ORM read / write surfaces yield and accept plain `T`.** Rows from `.first()`, `for await ... of c.all()`, and `.firstOrThrow()` hold plain decoded values; write inputs (`CreateInput`, `MutationUpdateInput`, `UniqueConstraintCriterion`, `ShorthandWhereFilter`) accept plain `T`. Pinned by 21 type tests in [sql-orm-client/test/codec-async.types.test-d.ts](packages/3-extensions/sql-orm-client/test/codec-async.types.test-d.ts) and live-Postgres integration in [test/integration/codec-async.test.ts](packages/3-extensions/sql-orm-client/test/integration/codec-async.test.ts).
- **Build-time stays synchronous.** `validateContract`, `validateMongoContract`, `postgres({...})`, and `createMongoAdapter()` all return synchronously — regression-locked at the type and runtime levels in [contract validate.test.ts (L856–L881)](packages/2-sql/1-core/contract/test/validate.test.ts), [postgres.test.ts (L112–L124)](packages/3-extensions/postgres/test/postgres.test.ts), [mongo-contract validate.test.ts (L662–L681)](packages/2-mongo-family/1-foundation/mongo-contract/test/validate.test.ts), and [mongo-adapter.test.ts (L435–L453)](packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts).
- **Build-time codec methods stay synchronous** — `encodeJson(value): JsonValue`, `decodeJson(json): TInput`, `renderOutputType?(...) : string | undefined`. They don't run per-row.
- **Existing error-envelope shapes are unchanged.** `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED` is preserved verbatim. The new `RUNTIME.ENCODE_FAILED` / `RUNTIME.DECODE_FAILED` envelopes follow the existing structured-details + `cause` pattern.

## Compatibility / migration / risk

- **Backward-compatible widening.** Every existing `codec()` / `mongoCodec()` call site uses the symmetric `TInput=TOutput` form; the `TOutput = TInput` default collapses the 5-generic shape to the old 4-generic shape. No source change required in any consumer (built-in codecs, adapters, runtime, integration fixtures).
- **`Promise.all` failure semantics are partial fail-fast.** The first rejected dispatch surfaces as the error envelope; remaining dispatched bodies still run to completion (they cannot be cancelled in standard `Promise.all`) but their outputs are discarded. From the user's point of view this matches the prior `for`-loop's "throw on first failure" behavior.
- **Allocation pressure.** Every codec dispatch allocates a Promise; for a query returning N rows × M codec'd cells, that's N × M allocations. The walk-back path below is preserved precisely to keep this cost recoverable without breaking the public surface.
- **Walk-back stays open.** Because no sync/async discriminator was introduced on the public surface, a future synchronous fast path can be added additively as `codecSync()`. ADR 204 transcribes the seven walk-back constraints verified absent across this project: no per-codec async marker; no `codecSync` / `codecAsync` variants today; no `isSync*` predicates; no conditional return types on Promise-returning methods; no `TRuntime` generic on `Codec` or `MongoCodec`; no async-dependent author-surface docs; no async-dependent build-time guarantees.
- **Test fixtures updated mechanically.** Inline `Codec`-shaped fixtures across `framework-components`, `sql-contract-ts`, `cli`, `integration-tests`, `pgvector`, `adapter-postgres`, and `adapter-sqlite` were updated by recipe: `decode: (wire) => wire` → `decode: async (wire) => wire`; add `encode: async (value) => value` when missing; prefix call sites with `await`; convert `expect(...).toThrow(...)` to `await expect(...).rejects.toThrow(...)`. No production-source escape hatches were needed; the factory's lift normalizes any combination of sync and async author functions.
- **No backwards-compatibility shims.** Per `AGENTS.md` § Golden Rules. The legacy `MongoCodecJsType<T>` extractor was replaced by `MongoCodecInput<T>` / `MongoCodecOutput<T>` (mirroring SQL's `CodecInput<T>` / `CodecOutput<T>`) without an alias.

## Alternatives considered

- **Per-codec `runtime: 'async'` marker.** Rejected. The cost lives in the wrong place: every call site (runtime dispatcher, SQL DSL, Mongo lowering, ORM generator, tests) has to handle both shapes via conditional return types and runtime branching. The seam is wrong: sync-vs-async cuts across query-time methods rather than aligning with the build-time-vs-query-time boundary the codec interface already has. Cross-family portability is harder: every codec definition has to be reshaped per family. And there is no clean walk-back path — once a marker is on the public surface, removing it is breaking.
- **Defer the change entirely.** Rejected. Async codecs unblock real work already on the roadmap: column-level encryption, redaction policy that consults external sources, and contract-side computed defaults that may need IO. Deferring forces consumers to wrap codecs around the runtime instead of inside it.

## Non-goals / intentionally out of scope

- **Synchronous fast path.** A future `codecSync()` opt-in is preserved as an additive non-breaking change; not landed in this project.
- **Mongo decode-side codec dispatch.** Mongo doesn't decode rows today; ADR 204 records the future pattern (mirror SQL's `decodeRow`).
- **Include-aggregate child-codec dispatch.** Orthogonal ORM feature; deferred.
- **Redaction-trigger spelling.** Orthogonal redaction-policy work; deferred.
