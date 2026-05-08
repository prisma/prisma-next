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

## Acceptance criteria

The following user-facing invariants are the canonical AC list for the
package post-Project-1 close-out. Each AC is pinned by an on-disk test
in `test/`; the references in test docblocks point back to this section
rather than at any transient project directory.

### Envelope + codec (`AC-ENV*`, `AC-CODEC*`)

- **AC-ENV1** — `EncryptedString.from(plaintext)` returns an envelope
  carrying the plaintext on a write-side handle whose ciphertext slot
  is unfilled until the bulk-encrypt middleware runs.
- **AC-ENV2** — `envelope.decrypt({ signal? })` returns plaintext via
  the SDK`s single-cell `decrypt`; `signal` is forwarded by identity
  (the slot is omitted when `signal` is undefined, preserving
  `exactOptionalPropertyTypes`).
- **AC-ENV3** — After `decryptAll(...)` returns, every touched
  envelope`s `decrypt()` returns the cached plaintext synchronously
  without consulting the SDK.
- **AC-ENV4** — The handle has no public TypeScript surface; pinned by
  a negative type test in `test/envelope.types.test-d.ts` and a
  runtime test asserting `Object.keys(envelope) === []` and
  `JSON.stringify(envelope) === '{"$encryptedString":"<opaque>"}'`.
- **AC-CODEC1..5** — `cipherstash/string@1` codec registered with
  target type `eql_v2_encrypted` and zero traits;
  `decode(wire, ctx)` builds an envelope whose handle carries
  `(table, column)` from `ctx.column`; `encode(envelope, ctx)` reads
  the ciphertext from the envelope`s handle (after middleware has
  populated it) and wraps it in the `eql_v2_encrypted` composite text
  format; `renderOutputType` returns `EncryptedString`;
  `RuntimeParameterizedCodecDescriptor` registered with the arktype
  `{ equality, freeTextSearch }` schema.

### Bulk-encrypt middleware (`AC-MW*`)

- **AC-MW1** — For N rows × 1 cipherstash column sharing one routing
  key, exactly one `bulkEncrypt` SDK call.
- **AC-MW2** — For multiple `(table, column)` routing keys, exactly
  one `bulkEncrypt` per group.
- **AC-MW3** — Middleware writes ciphertexts back to envelope handles
  so the codec`s `encode` reads them; `setHandleCiphertext` populates
  the handle without zeroing the plaintext slot.
- **AC-MW4** — `ctx.signal` forwarded by identity to `bulkEncrypt`;
  cancellation observable downstream.
- **AC-MW5** — Plaintext slot retained post-encrypt; the write-side
  envelope`s `decrypt()` returns synchronously without invoking the
  SDK`s single-cell `decrypt`.

### Operator lowering (`AC-OP*`)

- **AC-OP1** — `email.cipherstashEq(plaintext)` lowers to
  `eql_v2.eq("table"."col", $N::eql_v2_encrypted)`.
- **AC-OP2** — `email.cipherstashIlike(pattern)` lowers to
  `eql_v2.ilike("table"."col", $N::eql_v2_encrypted)`.
- **AC-OP3** — `email.isNull()` lowers to `email IS NULL` directly;
  no EQL involvement, no parameter binding (the framework`s
  `NullCheckExpr` bypasses the operator registry entirely).
- **AC-OP4** — `email.isNotNull()` lowers to `email IS NOT NULL`;
  registering `cipherstashEq` / `cipherstashIlike` (not `eq` / `ilike`)
  leaves the framework`s built-in handlers untouched on
  non-cipherstash columns. Combined with the codec declaring zero
  traits at all three sites (see `equality-trait-removal.test.ts`),
  `email.eq(...)` is a type error on cipherstash columns — the
  framework`s trait-gated `=` lowering is unreachable, eliminating a
  wrong-SQL footgun on randomized EQL ciphertexts.

### `decryptAll` walker (`AC-DEC*`)

- **AC-DEC1** — Walks recursively (objects, arrays, nested envelopes)
  and decrypts every `EncryptedString` it finds. Skips already-cached
  envelopes; passes over exotic containers (`Date`, `Map`, `Set`,
  `Uint8Array`); cycle-safe.
- **AC-DEC2** — For K envelopes across distinct routing keys, exactly
  one `bulkDecrypt` per `(sdk, table, column)` group.
- **AC-DEC3** — After return, every touched envelope`s `decrypt()`
  returns the cached plaintext synchronously without consulting the
  SDK.
- **AC-DEC4** — `opts.signal` forwarded by identity to the SDK on
  every `bulkDecrypt` call. The slot is omitted from the SDK call
  when `opts.signal` is undefined.

### Cancellation envelope (`AC-UMB5`)

- **AC-UMB5** — `RUNTIME.ABORTED` envelope wrapping at every
  cipherstash-internal phase (`bulk-encrypt`, `decrypt`,
  `decrypt-all`). Mirrors the framework`s
  `runtimeError(RUNTIME_ABORTED, ...)` envelope shape exactly; only
  the legal `details.phase` string set widens (the cipherstash phase
  strings are not added to the framework`s `RuntimeAbortedPhase`
  union). Codec encode/decode are intentionally left unwrapped — the
  framework`s `encodeParams` / `decodeRow` per-cell race already
  raises `RUNTIME.ABORTED { phase: 'encode' | 'decode' }` per ADR 207.

### Umbrella round-trips (`AC-UMB*`)

- **AC-UMB1** — Live PSL e2e: `dbInit` + migration + insert (via
  `EncryptedString.from(...)`) + equality search via `cipherstashEq` +
  contains search via `cipherstashIlike` + `decryptAll` round-trip,
  exercised end-to-end against PGlite using a synthetic EQL bundle.
- **AC-UMB2** — TS contract authoring (`encryptedString({...})`)
  produces a `contract.json` byte-identical to the PSL version
  (`cipherstash.EncryptedString({...})`), pinned by the parity
  fixture under
  `test/integration/test/authoring/parity/cipherstash-encrypted-string/`.
- **AC-UMB3** — Bulk amortization: 1 × `bulkEncrypt` for 10 inserts;
  1 × `bulkDecrypt` for `decryptAll` over 10 rows in the same routing
  group.
- **AC-UMB4** — Nullable variant
  (`email: EncryptedString({ equality: true })?`): mixed-null insert
  bypasses null cells in the bulk-encrypt batch (1 × `bulkEncrypt`
  for the 5 non-null rows out of 10);
  `email.isNull()` / `email.isNotNull()` lower to
  `WHERE email IS NULL` / `WHERE email IS NOT NULL` directly via
  `NullCheckExpr` (not `eql_v2.eq`); the operator registry is not
  consulted; `decryptAll(mixedRows)` over 10 mixed-null rows issues
  exactly 1 × `bulkDecrypt` with 5 ciphertexts (the walker passes
  over null cells via the `value === null` short-circuit).
- **AC-UMB6** — `pnpm lint:deps` clean for the package`s subtree.
- **AC-UMB7** — A worked example exists under
  `examples/cipherstash-integration/` exercising the
  insert → `cipherstashEq` → `cipherstashIlike` → `decryptAll`
  round-trip end-to-end with a demo SDK stub.
- **AC-UMB8** — Strict `dbInit` preserved — no `strictVerification:
  false` anywhere in the cipherstash subtree.
- **AC-UMB9** — Tree-shakable control vs runtime / middleware planes:
  `./control` does not pull `EncryptedString`, the SDK interface, the
  codec runtime, or the bulk-encrypt middleware; `./runtime` and
  `./middleware` do not pull contract-space artefacts
  (`cipherstashContract`, `cipherstashBaselineMigration`,
  `cipherstashHeadRef`, the codec lifecycle hook) or EQL bundle
  migration-op terms (`add_search_config`, `remove_search_config`).
  Pinned by the canonical guard at `test/bundling-isolation.test.ts`
  (entry-body forbidden-substring check + chunk-graph disjointness
  modulo the shared `constants-*.mjs` chunk).

## References

- [pgvector extension](../pgvector/README.md) and its
  `src/exports/runtime.ts` — the structural precedent for codec,
  parameterized descriptor, and pack-meta layout.
- [ADR 207 — Codec call context (per-query AbortSignal and column
  metadata)](../../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md).
- [ADR 208 — Higher-order codecs for parameterized
  types](../../../docs/architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md).
