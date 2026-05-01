# Developing `@prisma-next/extension-cipherstash`

Contributor-facing notes for the cipherstash extension. The user-facing
surface lives in `README.md`; this file collects the in-progress
milestones, internal layout, and design choices a contributor needs
to know when extending the package.

## Source layout

```
packages/3-extensions/cipherstash/
└── src/
    ├── core/
    │   ├── envelope.ts         EncryptedString class + handle helpers
    │   ├── sdk.ts              CipherstashSdk interface (framework-native shape)
    │   ├── codecs.ts           cipherstash/string@1 codec factory
    │   ├── parameterized.ts    RuntimeParameterizedCodecDescriptor + arktype params schema
    │   └── eql-bundle.ts       EQL install SQL (placeholder until live-DB integration)
    └── exports/
        ├── index.ts            EncryptedString + CipherstashSdk types
        ├── runtime.ts          SqlRuntimeExtensionDescriptor factory
        ├── control.ts          SqlControlExtensionDescriptor + databaseDependencies.init
        ├── column-types.ts     placeholder for the encryptedString({...}) TS factory
        └── middleware.ts       placeholder for the bulkEncryptMiddleware factory
```

## Implemented surface

- `EncryptedString.from(plaintext)` and `EncryptedString.fromInternal({...})` envelope constructors.
- `envelope.decrypt({ signal? })` — returns cached plaintext when present, otherwise routes through the SDK's single-cell `decrypt` and forwards the caller-supplied `AbortSignal` by identity.
- `cipherstash/string@1` codec with target type `eql_v2_encrypted`, traits `['equality']`, and `renderOutputType` returning `EncryptedString`.
- `RuntimeParameterizedCodecDescriptor<{equality, freeTextSearch}>` with arktype params schema validated at the contract boundary.
- `SqlControlExtensionDescriptor` with one `databaseDependencies.init` entry installing EQL via the placeholder bundle in `core/eql-bundle.ts`.

## Forthcoming surface (in-flight work)

| Surface                                            | Tracked under                |
| -------------------------------------------------- | ---------------------------- |
| `encryptedString({...})` TS contract factory       | next milestone (M2.b)        |
| `bulkEncryptMiddleware(sdk)` factory               | M2.c                         |
| Real EQL install bundle (replaces placeholder)     | M2.c                         |
| Live-Postgres + live-EQL integration tests         | M2.c                         |
| `eq` / `ilike` operator lowering                   | M3 / M4                      |
| `decryptAll(rows, opts?)` walker                   | M4                           |

The shipping package surface — subpath exports, codec id, descriptor
shapes — is stable across these milestones; the placeholders in
`exports/column-types.ts` and `exports/middleware.ts` get populated
in place rather than restructured.

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

### Codec is constructed per SDK binding

`createCipherstashStringCodec(sdk)` is a factory rather than a module
singleton. The codec's `decode` body captures the SDK so the
read-side envelope can issue `decrypt({ signal? })` against it. This
differs from pgvector (whose codec is fully stateless and *can* be a
module singleton) but aligns with multi-tenant deployments
constructing one extension descriptor per tenant.

### `CipherstashSdk` is framework-native, not the upstream SDK shape

The interface declares three async methods (`decrypt`, `bulkEncrypt`,
`bulkDecrypt`), each accepting an optional `AbortSignal`. This is
deliberately smaller than CipherStash's upstream `EncryptionClient`
(rich `EncryptOperation` / `LockContext` / lazy-init machinery) so
real-world usage wraps the upstream client behind a thin adapter
satisfying `CipherstashSdk`. Keeps the framework-side surface free
of upstream-specific types.

### EQL install SQL is a placeholder

`src/core/eql-bundle.ts` ships a placeholder string today; the real
~170 KB bundle gets vendored in alongside the live-Postgres + live-EQL
integration tests. The placeholder makes the
`databaseDependencies.init` shape exercise-able in unit tests
without committing the large vendored file ahead of the integration
plumbing.

## References

- [pgvector extension](../pgvector/README.md) and its `src/exports/runtime.ts` — the structural precedent for codec, parameterized descriptor, and `databaseDependencies.init` shape.
- [ADR 207 — Codec call context (per-query AbortSignal and column metadata)](../../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md).
- [ADR 208 — Higher-order codecs for parameterized types](../../../docs/architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md).
