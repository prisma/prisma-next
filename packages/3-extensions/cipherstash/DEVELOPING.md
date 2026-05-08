## Developing `@prisma-next/extension-cipherstash`

Contributor-facing notes for the cipherstash extension. The user-facing
surface lives in `README.md`; this file collects the in-progress
milestones, internal layout, and design choices a contributor needs to
know when extending the package.

## Source layout

```
packages/3-extensions/cipherstash/
└── src/
    ├── core/
    │   ├── envelope.ts           EncryptedString class + handle helpers
    │   ├── sdk.ts                CipherstashSdk interface (framework-native shape)
    │   ├── codec-runtime.ts      cipherstash/string@1 SDK-bound codec factory
    │   ├── codec-metadata.ts     cipherstash/string@1 SDK-free metadata codec (for pack-meta)
    │   ├── parameterized.ts      RuntimeParameterizedCodecDescriptor + arktype params schema
    │   ├── authoring.ts          cipherstash.EncryptedString PSL constructor descriptor
    │   ├── descriptor-meta.ts    cipherstashPackMeta (authoring + storage + codec metadata)
    │   ├── cipherstash-codec.ts  control-plane codec lifecycle hook (TML-2397)
    │   ├── contract.ts           contract-space ContractIR (TML-2397)
    │   ├── migrations.ts         contract-space baseline migration (TML-2397)
    │   ├── eql-bundle.ts         EQL install SQL (vendored byte-for-byte)
    │   └── constants.ts          shared identifiers (codec id, native types, invariant ids)
    └── exports/
        ├── control.ts            SqlControlExtensionDescriptor (control-plane entry)
        ├── runtime.ts            EncryptedString + SDK + parameterized codec (runtime entry)
        ├── pack.ts               cipherstashPackMeta default export (TS contract authoring)
        └── column-types.ts       encryptedString({...}) TS contract factory
```

## Implemented surface

- `cipherstash.EncryptedString({ equality?, freeTextSearch? })` PSL
  constructor and the `encryptedString({...})` TS factory; both lower
  to a `ColumnTypeDescriptor` byte-identical to the other (verified
  by the parity fixture under
  `test/integration/test/authoring/parity/cipherstash-encrypted-string/`).
- `EncryptedString.from(plaintext)` and
  `EncryptedString.fromInternal({ ciphertext, table, column, sdk })`
  envelope constructors (handle is package-private).
- `envelope.decrypt({ signal? })` — returns cached plaintext when
  present, otherwise routes through the SDK's single-cell `decrypt`
  and forwards the caller-supplied `AbortSignal` by identity via
  `ifDefined` from `@prisma-next/utils/defined`.
- `cipherstash/string@1` codec with target type `eql_v2_encrypted`,
  no codec traits, and `renderOutputType` returning `EncryptedString`.
  Equality search is delivered via the cipherstash-namespaced
  `cipherstashEq` / `cipherstashIlike` operators (see `src/core/operators.ts`)
  rather than the framework's trait-gated built-in `eq` — declaring
  `equality` here would expose a wrong-SQL footgun on cipherstash
  columns because EQL ciphers contain randomized nonces.
- `RuntimeParameterizedCodecDescriptor<{ equality, freeTextSearch }>`
  with arktype `paramsSchema` validated at the contract boundary.
- `SqlControlExtensionDescriptor` carrying the contract-space
  artefacts (TML-2397) plus pack-meta authoring contributions and
  the codec lifecycle hook.

## Forthcoming surface (in-flight work)

Tracked under the `cipherstash-integration / project-1` plan:

| Surface                                                  | Round  |
| -------------------------------------------------------- | ------ |
| `bulkEncryptMiddleware(sdk)` factory                     | M2 R3  |
| `createCipherstashRuntimeDescriptor({ sdk })` wrapper    | M2 R3  |
| Real EQL install bundle (replaces placeholder)           | M2 R3  |
| Live-Postgres + live-EQL storage round-trip e2e          | M2 R3  |
| `eq` / `ilike` operator lowering                         | M3     |
| `decryptAll(rows, opts?)` walker                         | M3     |

The shipping package surface — subpath exports, codec id, descriptor
shapes — is stable across these milestones; new surfaces ship as
separate subpath exports rather than restructuring existing ones.

## Design choices worth knowing

### Handle storage — `WeakMap`

The `EncryptedStringHandle` shape is a module-private mutable record
keyed off a module-scoped `WeakMap<EncryptedString, ...>`. The
alternative — `#`-prefixed class fields — provides the same
package-internal isolation, but the `WeakMap` shape keeps
`Object.keys(envelope)` and the default `JSON.stringify` shape
trivially clean across every JS host without per-class `toJSON`
overrides. (A `toJSON()` override ships anyway to produce the
documented `{ "$encryptedString": "<opaque>" }` placeholder.)

### Plaintext is retained post-encrypt

The bulk-encrypt middleware (M2 R3) populates the handle's ciphertext
slot but does **not** zero the plaintext slot. Zeroing in JS is
best-effort (strings are immutable) and the GC-driven lifecycle is
sufficient for this project's scope. As a side effect, a write-side
envelope's `decrypt()` returns the original plaintext synchronously
without an SDK round-trip.

### Codec is constructed per SDK binding

`createCipherstashStringCodec(sdk)` is a factory rather than a module
singleton. The codec's `decode` body captures the SDK so the
read-side envelope can issue `decrypt({ signal? })` against it. This
differs from pgvector (whose codec is fully stateless and *can* be a
module singleton) but aligns with multi-tenant deployments
constructing one extension descriptor per tenant.

### SDK-free metadata codec for pack-meta

`core/codec-metadata.ts` ships an SDK-free codec used in
`cipherstashPackMeta.types.codecTypes.codecInstances`. Pack-meta
consumers only read codec metadata (`typeId`, `targetTypes`,
`traits`, `renderOutputType`) at contract emit time — they never
call `encode`/`decode`. Keeping the metadata codec separate from the
SDK-bound runtime codec preserves the control vs runtime split:
control-plane consumers (`exports/control.ts`, `exports/pack.ts`)
pull this file but never the envelope, the SDK interface, or the
codec runtime.

### `CipherstashSdk` is framework-native, not the upstream SDK shape

The interface declares three async methods (`decrypt`, `bulkEncrypt`,
`bulkDecrypt`), each accepting an optional `AbortSignal`. This is
deliberately smaller than CipherStash's upstream `EncryptionClient`
(rich `EncryptOperation` / `LockContext` / lazy-init machinery) so
real-world usage wraps the upstream client behind a thin adapter
satisfying `CipherstashSdk`. Keeps the framework-side surface free of
upstream-specific types.

### Routing key is `(table, column)`

`bulkEncrypt` and `bulkDecrypt` accept a `routingKey: { table,
column }` so each ZeroKMS round-trip handles one homogeneous batch.
The envelope's read-side handle carries the same `(table, column)`
captured from `SqlCodecCallContext.column` at decode time so
`decrypt({ signal? })` can issue the right routing.

## References

- [pgvector extension](../pgvector/README.md) and its
  `src/exports/runtime.ts` — the structural precedent for codec,
  parameterized descriptor, and pack-meta layout.
- [ADR 207 — Codec call context (per-query AbortSignal and column
  metadata)](../../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md).
- [ADR 208 — Higher-order codecs for parameterized
  types](../../../docs/architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md).
