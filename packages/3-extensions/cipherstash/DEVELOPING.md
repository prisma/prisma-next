# Developing `@prisma-next/extension-cipherstash`

Contributor-facing notes for the cipherstash extension. The user-facing
surface lives in [`README.md`](./README.md); this file collects the
internal layout, the substrate architecture, the per-codec wiring
template, and the design choices a contributor needs to know when
extending the package.

## Source layout

```text
packages/3-extensions/cipherstash/
├── contract.{json,d.ts}              emitted contract-space artefacts
├── migrations/cipherstash/           emitted on-disk migrations
├── refs/head.json                    hand-pinned contract-space head ref
└── src/
    ├── contract/
    │   ├── authoring.ts              cipherstash.Encrypted<X>() PSL constructors (six)
    │   └── contract.d.ts             contract-space declaration
    ├── execution/
    │   ├── envelope-base.ts          EncryptedEnvelopeBase<T> shared substrate
    │   ├── envelope.ts               EncryptedString (extends base)
    │   ├── envelope-double.ts        EncryptedDouble
    │   ├── envelope-bigint.ts        EncryptedBigInt + parseDecryptedValue override
    │   ├── envelope-date.ts          EncryptedDate + parseDecryptedValue override
    │   ├── envelope-boolean.ts       EncryptedBoolean
    │   ├── envelope-json.ts          EncryptedJson
    │   ├── cell-codec-factory.ts     makeCipherstashCellCodec({...}) factory
    │   ├── codec-runtime.ts          createCipherstashStringCodec(sdk) (legacy entry)
    │   ├── parameterized.ts          RuntimeParameterizedCodecDescriptor for all six
    │   ├── operators.ts              13 predicate operators + asEncryptedParam dispatch
    │   ├── helpers.ts                4 free-standing helpers (Asc / Desc / JsonbPath…)
    │   ├── decrypt-all.ts            opt-in read-side bulk-decrypt walker
    │   ├── routing.ts                physical-column-name routing-key helpers
    │   ├── sdk.ts                    CipherstashSdk interface (framework-native)
    │   └── abort.ts                  RUNTIME.ABORTED envelope wrappers
    ├── extension-metadata/
    │   ├── constants.ts              codec ids, EQL native type, CIPHERSTASH_CODEC_IDS tuple,
    │   │                             isCipherstashCodecId guard, namespaced-trait casts
    │   ├── codec-metadata.ts         SDK-free codec instances for pack-meta authoring
    │   └── descriptor-meta.ts        cipherstashPackMeta + authoring + storage + codec instances
    ├── middleware/
    │   └── bulk-encrypt.ts           bulkEncryptMiddleware(sdk) + stampRoutingKeysFromAst
    ├── migration/
    │   ├── codec-hooks-factory.ts    makeCipherstashCodecHooks({...}) factory (per codec)
    │   ├── cipherstash-codec.ts      cipherstashStringCodecHooks (legacy entry)
    │   ├── call-classes.ts           CipherstashAddSearchConfigCall / RemoveSearchConfigCall
    │   ├── eql-bundle.ts             EQL install SQL (vendored byte-for-byte)
    │   └── eql-install.generated.ts  generated EQL install op definitions
    ├── types/
    │   ├── codec-types.ts            CipherstashCodecTypes interface (decode return types)
    │   └── operation-types.ts        QueryOperationTypes augmentation (column-method surface)
    └── exports/
        ├── control.ts                SqlControlExtensionDescriptor (control-plane entry)
        ├── runtime.ts                Envelope classes + SDK + codec runtime + decryptAll +
        │                             4 free-standing helpers (runtime entry)
        ├── middleware.ts             bulkEncryptMiddleware (runtime middleware entry)
        ├── migration.ts              call-classes re-export
        ├── pack.ts                   cipherstashPackMeta default export (TS contract authoring)
        ├── column-types.ts           6 TS contract factories (encryptedString / Double / …)
        ├── codec-types.ts            codec-types augmentation re-export
        ├── operation-types.ts        operation-types augmentation re-export
        └── contract-space-typing.ts  helper types for contract-space consumers
```

## Substrate architecture

The package centres on a shared substrate that lets every cipherstash codec be one factory call away from the same shape. Three substrate factories carry the load:

### `EncryptedEnvelopeBase<T>` — shared envelope superclass

`packages/3-extensions/cipherstash/src/execution/envelope-base.ts` exports an abstract `EncryptedEnvelopeBase<T>` class that holds the `#`-prefixed `EncryptedHandle<T>` slot and ships the five redaction overrides (`toJSON`, `toString`, `valueOf`, `Symbol.toPrimitive`, `Symbol.for('nodejs.util.inspect.custom')`), `expose()`, `decrypt({ signal? })`, and the post-decrypt plaintext cache.

Each concrete subclass:

- Holds nothing of its own beyond a static `from(plaintext: T): Self` and `fromInternal(args): Self`.
- May override `parseDecryptedValue(plaintext: unknown): T` when the SDK round-trips through a JS type that differs from the envelope's `T`. `EncryptedBigInt` overrides this to coerce SDK `number | string` → `bigint`; `EncryptedDate` overrides it to coerce ISO strings → `Date`.

The base class also stamps the redacted JSON placeholder per subclass (`{ "$encryptedString": "<opaque>" }` vs `{ "$encryptedBigInt": "<opaque>" }`) so accidental `JSON.stringify` paths reveal the *type* but not the *value*.

### `makeCipherstashCellCodec({...})` — runtime cell-codec factory

`src/execution/cell-codec-factory.ts` exports a single factory that builds a `cipherstash/<type>@1` `CellCodec` given:

- The `codecId` to register under.
- The envelope subclass's `fromInternal({ ciphertext, table, column, sdk })` constructor — picked up by reference, not by ID.
- The Postgres native type (`eql_v2_encrypted` for every cipherstash codec).
- The static `traits: []` declaration (the wrong-SQL-footgun protection — see [ADR 214](../../../docs/architecture%20docs/adrs/ADR%20214%20-%20Extension%20operator%20surface%20namespaced%20replacement%20operators.md)).

Per-codec `encode(envelope, ctx)` and `decode(wire, ctx)` bodies are the same shape across all six codecs: encode reads the envelope handle's ciphertext (already populated by the bulk-encrypt middleware) and wraps it in the `eql_v2_encrypted` composite text format; decode constructs the right envelope subclass via the captured `fromInternal` constructor.

### `makeCipherstashCodecHooks({ flagToIndex, castAs })` — codec lifecycle hook factory

`src/migration/codec-hooks-factory.ts` exports the factory that builds a `CodecControlHooks` instance given:

- A `flagToIndex` map from the codec's search-mode flags to EQL search-config index names (e.g. `{ equality: 'unique', orderAndRange: 'ore' }`).
- The EQL `cast_as` value (`'text'`, `'double'`, `'big_int'`, `'date'`, `'boolean'`, `'jsonb'`).

The factory's returned hook reads `typeParams` off the column (the validated cipherstash search-mode flags) and emits one `cipherstashAddSearchConfig(table, column, index)` op per enabled flag at field-added events, and the corresponding `cipherstashRemoveSearchConfig(...)` at field-dropped events. Flag flips (`true → false` between contract versions) emit a removal at the field-altered event. The framework's destructive-op classification surfaces removals via the standard planner mechanisms — no cipherstash-specific warning policy.

## Per-codec wiring template

Adding a new cipherstash codec (e.g. a hypothetical `cipherstashInt` for non-bigint integer support) touches the following files **in this order**. Each step is one or two lines; the substrate factories carry the variable shape.

1. **Constants** (`src/extension-metadata/constants.ts`). Add the codec id (`'cipherstash/int@1'`), append to the `CIPHERSTASH_CODEC_IDS` stable-order tuple, and the closed-union `CipherstashCodecId` widens automatically. The `isCipherstashCodecId` guard picks up the new entry through the constant tuple.

2. **Envelope class** (`src/execution/envelope-<type>.ts`). New file extending `EncryptedEnvelopeBase<T>` where `T` is the new codec's JS plaintext type. Add a `parseDecryptedValue` override only if the SDK round-trip introduces a type mismatch (e.g. `EncryptedBigInt`'s `number | string → bigint` coercion). Re-export from `src/exports/runtime.ts`.

3. **Cell-codec factory call** (`src/execution/parameterized.ts`). One factory invocation: `makeCipherstashCellCodec({ codecId, fromInternal: EncryptedInt.fromInternal, ... })`. The parameterized-descriptor registration in the same file picks it up.

4. **Codec lifecycle hooks** (`src/migration/codec-hooks-factory.ts` consumer; new constant in the same file or co-located). One factory invocation: `cipherstashIntCodecHooks = makeCipherstashCodecHooks({ flagToIndex: { equality: 'unique', orderAndRange: 'ore' }, castAs: 'int' })`. Add it to the hook export.

5. **PSL constructor** (`src/contract/authoring.ts`). Add a `cipherstash.EncryptedInt` constructor descriptor mirroring the others. The arktype params schema (validating the codec's search-mode flags) goes alongside.

6. **TS factory** (`src/exports/column-types.ts`). Add `encryptedInt({...})` mirroring `encryptedBigInt`. Defaults map every search-mode flag to `true`.

7. **Parameterized codec descriptor** (`src/execution/parameterized.ts`). Add the new codec to `createParameterizedCodecDescriptors(sdk)` so the per-tenant SDK binding reaches it.

8. **Operator type-visibility** (`src/types/operation-types.ts`). Add the new codec id to whichever `QueryOperationTypes` entries the new codec should surface predicates from. Trait-keyed entries (the multi-codec predicates: `cipherstashEq`, `cipherstashGt`, etc.) pick it up automatically through the `cipherstash:`-namespaced trait dispatch.

9. **Codec-types augmentation** (`src/types/codec-types.ts`). Add an entry mapping the new codec id to the envelope class's decode-side TypeScript type (used by the framework's decode-result typing).

10. **Pack-meta authoring** (`src/extension-metadata/descriptor-meta.ts`). Append the new authoring entry + storage entry + codec instance to `cipherstashPackMeta`.

11. **Parity fixture** (`test/integration/test/authoring/parity/cipherstash-encrypted-<type>/`). New PSL + TS contract pair authoring the same column under the new codec; pinned by the shared parity harness.

12. **Codec-specific tests** (`test/envelope-<type>.test.ts`, `test/operator-lowering.test.ts` extension). Cover the envelope's redaction overrides + `parseDecryptedValue` if present, and the per-codec predicate lowerings.

The order is mechanical; the substrate factories are the leverage that makes adding a new codec a ~20-line change across these files.

## The operator surface — predicate vs helper

The 17 cipherstash operators decompose along the framework's predicate / non-predicate cleavage per [ADR 214 — Extension operator surface](../../../docs/architecture%20docs/adrs/ADR%20214%20-%20Extension%20operator%20surface%20namespaced%20replacement%20operators.md).

### Predicate operators — column-method surface

Return `Expression<{codecId: 'pg/bool@1', nullable: ...}>`. Surface as column methods through the operation registry; the model accessor synthesises them onto columns whose codec carries the required `cipherstash:*` trait.

- **Source**: `src/execution/operators.ts` (one factory per predicate, registered through the framework's `OperationRegistry` SPI).
- **Dispatch**: trait- or codec-id-keyed entries in `QueryOperationTypes` (`src/types/operation-types.ts`). Multi-codec predicates (`cipherstashEq`, `cipherstashGt`, `cipherstashLt`, etc.) key off `cipherstash:equality` / `cipherstash:order-and-range` so a new codec advertising those traits picks up the predicates automatically.
- **Encoded-arg path**: `asEncryptedParam(plaintext, columnRef)` dispatches on the column's codec id to construct the right envelope subclass; the dispatch table is typed `Readonly<Record<CipherstashCodecId, EnvelopeCoercer>>` over the closed-union `CipherstashCodecId` so a new codec id without a matching dispatch entry is a TS error. The envelope's handle carries the column's `(table, column)` routing key from the `ParamRef.of({ refs: { table, column } })` call site so the bulk-encrypt middleware can group it correctly.

### Free-standing helpers — non-predicate surface

Return non-boolean shapes: `OrderByItem` for sort, `Expression<cipherstash/json@1>` for SELECT-expression accessors.

- **Source**: `src/execution/helpers.ts`. Each helper is a pure function exported from `@prisma-next/extension-cipherstash/runtime`.
- **Dispatch**: none. The helpers are typed at their function-declaration site; there is no registry participation. Calls like `cipherstashAsc(u.salary)` validate the column's codec id at runtime via `getCodecId(col, helperName)` and throw a descriptive `TypeError` on mismatch.
- **AST primitives**: sort helpers return `OrderByItem.asc/desc(col.buildAst())` directly (bare-column form; EQL's native operator overloads on `eql_v2_encrypted` handle the comparison at the Postgres level). JSON helpers construct an `Expression`-shaped `OperationExpr` via `buildOperation({ method, args, returns, lowering })` — the same framework primitive that powers the predicate registrations.
- **No `QueryOperationTypes` entry** — by design. The split is documented in `src/execution/helpers.ts`'s top-of-file docblock and the per-helper JSDoc.

## Cipherstash-namespaced traits

The cipherstash codecs use `cipherstash:`-prefixed traits exclusively — `cipherstash:equality`, `cipherstash:order-and-range`, `cipherstash:free-text-search`, `cipherstash:searchable-json`. These sit *outside* the framework's closed `CodecTrait` union ([ADR 202](../../../docs/architecture%20docs/adrs/ADR%20202%20-%20Codec%20trait%20system.md)) deliberately:

- The framework union is closed for the built-in trait set so trait-gated synthesis can reason exhaustively. A cipherstash codec advertising the framework's `equality` trait would mean the built-in `m.col.eq(...)` synthesises on cipherstash columns and lowers to SQL `=` against a randomised EQL ciphertext — the wrong-SQL footgun this design closes.
- Extension traits are open-ended — they're per-extension capability declarations the framework does not need to recognise. The cipherstash operator registry consumes them; the framework's `eq`-synthesis path does not.

The cast from extension trait names to the framework-internal `CodecTrait` array shape is localised to one site at `src/extension-metadata/constants.ts` with a rationale comment citing the framework type, the model-accessor's `readonly string[]` widening at the dispatch site, and the wrong-SQL-`eq` footgun rationale. This is the only `as unknown as ...` cast in the package; all other type discipline is explicit.

A pinned regression test at `test/equality-trait-removal.test.ts` asserts every cipherstash codec's `traits` array contains only `cipherstash:`-namespaced strings — catches a regression where someone re-introduces the framework `equality` trait by accident.

## The `parseDecryptedValue` hook contract

`EncryptedEnvelopeBase<T>` exposes a protected `parseDecryptedValue(plaintext: unknown): T` hook that subclasses override when the SDK round-trips through a JS type that differs from the envelope's `T`.

Used by:

- The single-cell `decrypt({ signal? })` path on the envelope itself.
- The `decryptAll(rows)` walker — every `(sdk, table, column)` group's `bulkDecrypt` returns `ReadonlyArray<unknown>`; the walker invokes `envelope.parseDecryptedValue(plaintexts[i])` per entry before caching the result on the envelope's handle.

The hook defaults to an identity cast (`plaintext as T`) so the common-case envelopes (`EncryptedString` for `string`, `EncryptedDouble` for `number`, `EncryptedBoolean` for `boolean`) need no override.

Subclasses that override:

- **`EncryptedBigInt`** — the `@cipherstash/stack` SDK's `JsPlaintext` union does not include `bigint`. The example app's SDK adapter converts `bigint → Number` with a `Number.MAX_SAFE_INTEGER` bounds check on the encrypt side; `EncryptedBigInt.parseDecryptedValue` coerces back via `BigInt(plaintext)` and accepts either `number` or `string` per the SDK's polymorphic return shape.
- **`EncryptedDate`** — accepts ISO-8601 strings from the SDK round-trip and returns a `Date` instance.
- **`EncryptedJson`** — defaults to identity (the SDK returns the parsed JSON value as-is).

## Runtime-side gotchas

### Physical column-name routing keys

The framework lowers the user's PSL field names through any `@map(...)` directives before middleware sees `ParamRef`s. The cipherstash bulk-encrypt middleware therefore receives **physical column names** (e.g. `accountid` rather than the PSL `accountId`), and the SDK's `bulkEncrypt(routingKey: { table, column })` round-trip is keyed on the physical name. The example app's SDK adapter at `examples/cipherstash-integration/src/sdk.ts` keeps its `tableRegistry` keyed by physical names to match.

This is structural — the routing key has to agree between the cipherstash bulk-encrypt middleware (which sees the lowered SQL) and the SDK's per-column EQL index lookup (which reads the schema-time physical name). The decoded envelope's `(table, column)` slot likewise carries the physical name.

### `bigint` SDK boundary

`@cipherstash/stack`'s SDK and ZeroKMS only accept `JsPlaintext = string | number | boolean | object | array` for plaintexts (no `bigint`). For `EncryptedBigInt`:

- **Encrypt side** (example app's SDK adapter, `examples/cipherstash-integration/src/sdk.ts`): converts `bigint → Number` with an eager `Number.MAX_SAFE_INTEGER` bounds check (throws on overflow). Values beyond the safe-integer range cannot be encrypted today.
- **Decrypt side** (envelope subclass, `src/execution/envelope-bigint.ts`): `parseDecryptedValue` accepts either `number` or `string` from the SDK and coerces back to `bigint` via the `BigInt(plaintext)` constructor.

This is a known limitation — lifting requires upstream SDK / ZeroKMS work.

### Polymorphic `CipherstashSdk.decrypt` return type

`CipherstashSdk.bulkDecrypt(...)` returns `Promise<ReadonlyArray<unknown>>` per spec FR1. The polymorphic return type is deliberate — the SDK round-trips a heterogeneous mix of plaintext shapes (`string | number | boolean | object | array`) and the example app's adapter mirrors that.

One small follow-up: the single-cell `CipherstashSdk.decrypt(...)` return type is currently typed `Promise<string>` from Project 1's string-only contract. A widening to `Promise<unknown>` would match the bulk shape and remove a runtime narrowing cast in `EncryptedEnvelopeBase.decrypt`. Filed as a one-line interface follow-up; tracked at the project's umbrella plan.

## Framework runtime middleware lifecycle reorder (T11.5)

The cipherstash bulk-encrypt middleware depends on `RuntimeMiddleware.beforeExecute` firing **before** the SQL family runtime encodes parameters to wire format. The framework's runtime middleware lifecycle was reordered under [TML-2375 T11.5](https://linear.app/prisma-company/issue/TML-2375) to make this position correct by construction — see [ADR 215 — Runtime middleware lifecycle](../../../docs/architecture%20docs/adrs/ADR%20215%20-%20Runtime%20middleware%20lifecycle%20beforeExecute%20before%20encodeParams.md) for the full design.

What this means for cipherstash-extension contributors: when the bulk-encrypt middleware's `beforeExecute(plan, ctx, paramsMutator)` body runs, `plan.params` carries cipherstash envelopes (the user-domain values from the AST → draft-lowering step) — *not* their wire-format ciphertext payloads. The middleware walks `plan.ast` to find envelope `ParamRef`s, groups them by `(table, column)`, calls `sdk.bulkEncrypt(...)`, and writes the resulting ciphertexts back onto the envelope handles via `setHandleCiphertext`. The subsequent `encodeDraftParams` step then reads `handle.ciphertext` successfully — no race with the codec's strict `encode` guard.

`runBeforeExecuteChain` (the framework helper extracted from `runWithMiddleware`) is what fires the middleware chain at the right position. The SQL family runtime calls it between `lowerToDraft` and `encodeDraftParams`; the pre-lowered fixture path calls it before re-encoding to apply any mutations. Cipherstash-extension contributors do not interact with `runBeforeExecuteChain` directly — the bulk-encrypt middleware is an ordinary `SqlMiddleware` consumer whose `beforeExecute` body is fired by the framework at the documented lifecycle position.

## Other design choices worth knowing

### Handle storage — SecretBox-style `#` field with redacting overrides

Every `EncryptedEnvelopeBase<T>` instance holds the `EncryptedHandle<T>` on a single `#`-prefixed class field. The plaintext and ciphertext are reachable through an explicit `envelope.expose()` accessor — that's the deliberate seam for callers who genuinely want the inner values. Every implicit serialization / coercion path (`toJSON`, `toString`, `valueOf`, `Symbol.toPrimitive`, `Symbol.for('nodejs.util.inspect.custom')`) returns a `[REDACTED]` placeholder (or, for `toJSON`, a typed `{ "$encrypted<Type>": "<opaque>" }` placeholder) so accidental `console.log`, `JSON.stringify`, template-literal interpolation, error string construction, and `util.inspect` paths cannot leak plaintext.

The encapsulation is deliberately not airtight (we do not use a closure-scoped `WeakMap` to hide the storage entirely) — the goal is to make plaintext access **explicit** at the call site, not **impossible**. Callers who need to round-trip envelopes across a network boundary can opt in via `envelope.expose()`.

### Plaintext is retained post-encrypt

The bulk-encrypt middleware populates the handle's ciphertext slot but does **not** zero the plaintext slot. Zeroing in JS is best-effort (strings are immutable) and the GC-driven lifecycle is sufficient. As a side effect, a write-side envelope's `decrypt()` returns the original plaintext synchronously without an SDK round-trip.

### Codec is constructed per SDK binding

The factory `createParameterizedCodecDescriptors(sdk)` is called per tenant — the codec's `decode` body captures the SDK so the read-side envelope can issue `decrypt({ signal? })` against it. This differs from pgvector (whose codec is fully stateless and *can* be a module singleton) but aligns with multi-tenant deployments constructing one extension descriptor per tenant. The seam is tracked at [TML-2388 — Codec-SDK binding refactor](https://linear.app/prisma-company/issue/TML-2388).

### SDK-free metadata codec for pack-meta

`src/extension-metadata/codec-metadata.ts` ships an SDK-free codec used in `cipherstashPackMeta.types.codecTypes.codecInstances`. Pack-meta consumers only read codec metadata (`typeId`, `targetTypes`, `traits`, `renderOutputType`) at contract emit time — they never call `encode`/`decode`. Keeping the metadata codec separate from the SDK-bound runtime codec preserves the control vs runtime split: control-plane consumers (`exports/control.ts`, `exports/pack.ts`) pull this file but never the envelope subclasses, the SDK interface, or the codec runtime.

### `CipherstashSdk` is framework-native, not the upstream SDK shape

The interface declares three async methods (`decrypt`, `bulkEncrypt`, `bulkDecrypt`), each accepting an optional `AbortSignal`. The values are typed polymorphically (`unknown` for the bulk paths) per Project 2 spec FR1. This is deliberately smaller than CipherStash's upstream `EncryptionClient` (rich `EncryptOperation` / `LockContext` / lazy-init machinery) so real-world usage wraps the upstream client behind a thin adapter satisfying `CipherstashSdk`. Keeps the framework-side surface free of upstream-specific types.

### `decryptAll(rows, opts?)` — opt-in read-side amortisation

The cell codec's `decode` returns envelope subclasses that defer their SDK round-trip until `envelope.decrypt(...)` is awaited; this keeps SELECT plans cheap when consumers only need a subset of encrypted columns or when consumers want to forward envelopes to a downstream service without ever reading the plaintext.

`decryptAll(rows)` is the read-side amortisation for the case where the consumer DOES want plaintexts: it walks the result-set graph (arrays, plain objects, nested envelopes; cycle-safe; skips already-decrypted envelopes; passes over exotic containers like `Date` / `Map` / `Set` / `Uint8Array`), partitions the discovered envelopes by `(sdk identity, table, column)`, and issues one `bulkDecrypt` SDK call per partition. The resolved plaintexts pass through each envelope's `parseDecryptedValue(...)` hook and cache back onto each envelope's handle so subsequent `envelope.decrypt()` calls return synchronously. Already-decrypted envelopes (write-side envelopes from `Encrypted<X>.from(plaintext)`, or read-side envelopes that already cached a plaintext) are not re-decrypted — a re-run of `decryptAll` over a previously-decrypted result set is a no-op.

The walker is intentionally narrow: traversing arbitrary graphs (JS-side `Map` / `Set` / `Date` containers) is out of scope and loud-skipped — embedding an envelope inside a `Map` value will not be discovered by the walker. Consumers needing such shapes should call `envelope.decrypt(...)` directly.

### Control vs runtime tree-shaking architecture

The package publishes three runtime-relevant subpath entries — `./control` (contract-space authoring + the codec lifecycle hooks), `./runtime` (envelope subclasses + SDK + codec runtime + `decryptAll` + free-standing helpers), and `./middleware` (bulk-encrypt middleware) — and each composes tree-shakably so a consumer pulling `./runtime` does not drag in the EQL bundle SQL or the codec lifecycle hooks (which would defeat the runtime-bundle size budget and leak control-plane behaviour into runtime call paths) and a consumer pulling `./control` does not drag in the runtime envelopes, the SDK interface, the codec runtime, or the bulk-encrypt middleware.

The split lives in the source layout: `src/exports/control.ts` only imports from `src/contract/`, `src/migration/`, `src/extension-metadata/`, and never from `src/execution/{envelope*, codec-runtime, parameterized, decrypt-all, helpers, operators}` nor from `src/middleware/`. `src/exports/runtime.ts` / `src/exports/middleware.ts` only import from the runtime-side source modules (and the shared `extension-metadata/constants.ts`). The `test/bundling-isolation.test.ts` guard pins this byte-level — asserting the entry `.mjs` files don't carry forbidden symbols and that the transitively-reached chunk-file sets are disjoint modulo the shared `constants-*.mjs` chunk.

The shared `constants-*.mjs` chunk is structurally permitted to live in both planes — it carries pure literal constants (codec ids, native types, invariant ids, the `CIPHERSTASH_CODEC_IDS` tuple, the `isCipherstashCodecId` guard) and no executable behaviour.

The cross-package convention (source-level discipline + bundling-isolation test, with rationale and assertion strategies) is documented in the extension-packs reference doc at [Extension-Packs-Naming-and-Layout § Tree-shakability between control and runtime planes](../../../docs/reference/Extension-Packs-Naming-and-Layout.md); this package is the worked example for that section.

## Tracked follow-ups

| Linear ticket | Surface |
| --- | --- |
| [TML-2388](https://linear.app/prisma-company/issue/TML-2388) | Codec-SDK binding refactor — pull the per-tenant SDK binding out of the codec factory closure into the descriptor seam so multi-tenant deployments don't re-author the codec per tenant. |
| Polymorphic `CipherstashSdk.decrypt` return type | One-line interface widening from `Promise<string>` to `Promise<unknown>` to mirror the bulk shape; removes a narrowing cast in `EncryptedEnvelopeBase.decrypt`. |
| [TML-2504 — Cipherstash JSONB path-exists predicate: STE-VEC selector hashing](https://linear.app/prisma-company/issue/TML-2504) | `cipherstashJsonbPathExists` against the live EQL bundle expects a hashed STE-VEC selector computed via the CipherStash SDK's `selector(...)` API; the framework currently binds the JSONpath as a plain `pg/text@1` `ParamRef`. Round-trip and the two SELECT-expression helpers (`cipherstashJsonbPathQueryFirst`, `cipherstashJsonbGet`) work; the predicate clause returns zero rows. Resolution requires either a client-side path-hashing middleware or an EQL-side plaintext-path overload. |

## Behavioural invariants pinned by tests

The following user-facing behaviours are pinned by on-disk tests in `test/` (package-level) and `test/integration/test/authoring/parity/` (cross-package parity harness). This section is the canonical statement of what the package guarantees; if you find yourself loosening one of these, that's the signal to add a regression test alongside.

### Envelope substrate

- `EncryptedEnvelopeBase<T>` ships the `#`-prefixed handle slot + five redaction overrides + `expose()` + `decrypt({ signal? })` + `parseDecryptedValue` hook. Every concrete envelope subclass extends it.
- `Encrypted<X>.from(plaintext)` returns a write-side envelope carrying the plaintext on its handle whose ciphertext slot is unfilled until the bulk-encrypt middleware runs.
- `envelope.decrypt({ signal? })` returns plaintext via the SDK's single-cell `decrypt`; `signal` is forwarded by identity (the slot is omitted when `signal` is undefined, preserving `exactOptionalPropertyTypes`).
- After `decryptAll(...)` returns, every touched envelope's `decrypt()` returns the cached plaintext synchronously without consulting the SDK.
- The handle has no public TypeScript surface; pinned per-subclass by `test/envelope-*.test.ts` runtime tests asserting `Object.keys(envelope) === []` and `JSON.stringify(envelope)` produces the documented redacted placeholder.

### Codec runtime

- Six codecs (`cipherstash/string@1`, `cipherstash/double@1`, `cipherstash/bigint@1`, `cipherstash/date@1`, `cipherstash/boolean@1`, `cipherstash/json@1`) all registered with target type `eql_v2_encrypted` and `traits: []`. `decode(wire, ctx)` builds the right envelope subclass whose handle carries `(table, column)` from `ctx.column`; `encode(envelope, ctx)` reads the ciphertext from the handle (after middleware populated it) and wraps it in `eql_v2_encrypted` composite text format; `renderOutputType` returns the codec's envelope class name.
- `RuntimeParameterizedCodecDescriptor` per codec, each with its own arktype `paramsSchema` validating that codec's search-mode flags.

### Bulk-encrypt middleware

- For N rows × 1 cipherstash column sharing one routing key, exactly one `bulkEncrypt` SDK call per `(table, column)` group.
- For M cipherstash columns across rows, exactly M `bulkEncrypt` calls.
- The middleware writes ciphertexts back to envelope handles via `setHandleCiphertext`; the codec's `encode` then reads them. Populating the handle does not zero the plaintext slot.
- `ctx.signal` forwarded by identity to `bulkEncrypt`; cancellation observable downstream.
- The middleware's `beforeExecute` fires before `encodeDraftParams` per [ADR 215](../../../docs/architecture%20docs/adrs/ADR%20215%20-%20Runtime%20middleware%20lifecycle%20beforeExecute%20before%20encodeParams.md).

### Operator lowering

- 13 predicate operators (`cipherstashEq` / `Ne` / `InArray` / `NotInArray` / `Ilike` / `NotIlike` / `Gt` / `Gte` / `Lt` / `Lte` / `Between` / `NotBetween` / `JsonbPathExists`) lower to the corresponding `eql_v2.*` function calls. Each is trait- or codec-id-gated.
- 4 free-standing helpers (`cipherstashAsc` / `Desc` / `JsonbPathQueryFirst` / `JsonbGet`) return `OrderByItem` / `Expression<cipherstash/json@1>`. Sort uses the bare-column form (no `eql_v2.order_by_<index>(col)` wrapping); JSON helpers construct `Expression`-shaped `OperationExpr` via `buildOperation({...})`.
- `m.col.isNull()` / `m.col.isNotNull()` lower to `m.col IS NULL` / `IS NOT NULL` directly via the framework's `NullCheckExpr`; no EQL involvement, no parameter binding. The operator registry is not consulted.
- `m.col.eq(...)` is unreachable on cipherstash columns at the model accessor (compile-time + runtime) — codec declares zero of the framework's built-in traits at all three sites (`codec-runtime.ts` / `codec-metadata.ts` / `parameterized.ts`). Pinned by `test/equality-trait-removal.test.ts`.

### `decryptAll` walker

- Walks recursively (objects, arrays, nested envelopes) and decrypts every cipherstash envelope it finds. Skips already-cached envelopes; passes over exotic containers (`Date`, `Map`, `Set`, `Uint8Array`); cycle-safe.
- For K envelopes across distinct routing keys, exactly one `bulkDecrypt` per `(sdk, table, column)` group.
- After return, every touched envelope's `decrypt()` returns the cached plaintext synchronously without consulting the SDK.
- `opts.signal` forwarded by identity to the SDK on every `bulkDecrypt` call. The slot is omitted from the SDK call when `opts.signal` is undefined.

### Cancellation envelope

- `RUNTIME.ABORTED` envelope wrapping at every cipherstash-internal phase (`bulk-encrypt`, `decrypt`, `decrypt-all`). Mirrors the framework's `runtimeError(RUNTIME_ABORTED, ...)` envelope shape exactly; only the legal `details.phase` string set widens (the cipherstash phase strings are not added to the framework's `RuntimeAbortedPhase` union). Codec encode/decode are intentionally left unwrapped — the framework's `encodeParams` / `decodeRow` per-cell race already raises `RUNTIME.ABORTED { phase: 'encode' | 'decode' }` per ADR 207.

### Authoring parity

- TS contract authoring (`encrypted<X>({...})`) produces a `contract.json` byte-identical to the PSL version (`cipherstash.Encrypted<X>({...})`) for every codec. Pinned by the parity fixtures at `test/integration/test/authoring/parity/cipherstash-encrypted-{string,double,bigint,date,boolean,json}/`.

### Live e2e umbrella round-trips

- One `*.e2e.test.ts` per codec under `examples/cipherstash-integration/test/e2e/` exercising the insert → `cipherstash<Predicate>` → optional `cipherstashAsc/Desc` → `decryptAll` round-trip against a live Postgres + EQL + ZeroKMS environment.
- A mixed-codec round-trip exercises four codecs (string + double + bigint + date) in one query, asserting the bulk-encrypt middleware coalesces one SDK call per `(table, column)` group.
- A `*.e2e.json.e2e.test.ts` covers the JSON codec's round-trip and the two SELECT-expression helpers; the `JsonbPathExists` predicate clause is skipped pending the STE-VEC selector hashing follow-up (see Tracked follow-ups).

### Layering + bundling

- `pnpm lint:deps` clean for the package's subtree.
- Strict `dbInit` preserved — no `strictVerification: false` anywhere in the cipherstash subtree.
- Tree-shakable control vs runtime / middleware planes pinned by `test/bundling-isolation.test.ts` (entry-body forbidden-substring check + chunk-graph disjointness modulo the shared `constants-*.mjs` chunk).

## References

- [pgvector extension](../pgvector/README.md) — the structural precedent for codec, parameterized descriptor, and pack-meta layout.
- [ADR 202 — Codec trait system](../../../docs/architecture%20docs/adrs/ADR%20202%20-%20Codec%20trait%20system.md).
- [ADR 207 — Codec call context per-query AbortSignal and column metadata](../../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md).
- [ADR 208 — Higher-order codecs for parameterized types](../../../docs/architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md).
- [ADR 212 — Contract spaces](../../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md).
- [ADR 213 — Codec lifecycle hooks](../../../docs/architecture%20docs/adrs/ADR%20213%20-%20Codec%20lifecycle%20hooks.md).
- [ADR 214 — Extension operator surface: namespaced replacement operators and the predicate/helper split](../../../docs/architecture%20docs/adrs/ADR%20214%20-%20Extension%20operator%20surface%20namespaced%20replacement%20operators.md).
- [ADR 215 — Runtime middleware lifecycle: `beforeExecute` fires before `encodeParams`](../../../docs/architecture%20docs/adrs/ADR%20215%20-%20Runtime%20middleware%20lifecycle%20beforeExecute%20before%20encodeParams.md).
