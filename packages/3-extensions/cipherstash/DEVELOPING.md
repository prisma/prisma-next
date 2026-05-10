## Developing `@prisma-next/extension-cipherstash`

Contributor-facing notes for the cipherstash extension. The user-facing
surface lives in `README.md`; this file collects the internal layout
and design choices a contributor needs to know when extending the
package.

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
  envelope constructors. The internal handle is reachable via the
  explicit `envelope.expose()` accessor; implicit serialization paths
  redact.
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

## Tracked follow-ups

| Linear ticket                                                | Surface                                                                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [TML-2388](https://linear.app/prisma-company/issue/TML-2388) | Codec-SDK binding refactor — pull the per-tenant SDK binding out of the codec factory closure into the descriptor seam so multi-tenant deployments don't re-author the codec per tenant. |

## Design choices worth knowing

### Handle storage — SecretBox-style `#` field with redacting overrides

The `EncryptedStringHandle` shape is held on a single `#`-prefixed
class field. The plaintext and ciphertext are reachable through an
explicit `envelope.expose()` accessor — that's the deliberate seam
for callers who genuinely want the inner values. Every implicit
serialization / coercion path (`toJSON`, `toString`, `valueOf`,
`Symbol.toPrimitive`, `Symbol.for('nodejs.util.inspect.custom')`)
returns a `[REDACTED]` placeholder so accidental `console.log`,
`JSON.stringify`, template-literal interpolation, error string
construction, and `util.inspect` paths cannot leak plaintext.

The encapsulation is deliberately not airtight (we do not use a
closure-scoped `WeakMap` to hide the storage entirely) — the goal is
to make plaintext access **explicit** at the call site, not
**impossible**. Callers who need to round-trip envelopes across a
network boundary can opt in via `envelope.expose()`.

### Plaintext is retained post-encrypt

The bulk-encrypt middleware populates the handle's ciphertext slot
but does **not** zero the plaintext slot. Zeroing in JS is best-effort
(strings are immutable) and the GC-driven lifecycle is sufficient. As
a side effect, a write-side envelope's `decrypt()` returns the
original plaintext synchronously without an SDK round-trip.

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

### Cipherstash-namespaced operator API + no-equality-trait

Encrypted equality and free-text search are exposed as
`email.cipherstashEq(value)` / `email.cipherstashIlike(pattern)` on
cipherstash columns — not as the framework's built-in `eq` / `ilike`.
The codec also declares **zero traits** at all three sites
(`core/codec-runtime.ts`, `core/codec-metadata.ts`,
`core/parameterized.ts`), so the framework's built-in `eq` (gated on
the `equality` trait per `COMPARISON_METHODS_META`) is *not
synthesized* on cipherstash columns — `email.eq(...)` is a type
error at the model accessor.

The combination is deliberate: an EQL `eql_v2_encrypted` payload
contains a randomized nonce, so a stock `=` lowering against the
JSONB column would always return `false` even on equal plaintexts.
Exposing equality only via the cipherstash-namespaced operator (which
lowers to `eql_v2.eq(...)`) closes a wrong-SQL footgun by
construction — at the type level for direct authoring, and at the
operator-registry level for any extension that might otherwise have
synthesized a built-in `=` lowering against the column. The
`equality-trait-removal.test.ts` regression test pins the
loud-failure invariant (the codec carries `traits: []` at all three
declarations + the three declarations agree).

This is a framework-vs-extension boundary worth recording: the
framework's built-in operator handlers live in operations whose
`required-trait` set the codec opts into; extensions whose codec
output cannot back the trait's wire semantics must (i) declare zero
traits, and (ii) ship namespaced replacement operators — which
should NOT shadow the framework's built-in name. The canonical
write-up of the pattern is [ADR 211 — Extension operator surface:
namespaced replacement operators](../../../docs/architecture%20docs/adrs/ADR%20211%20-%20Extension%20operator%20surface%20namespaced%20replacement%20operators.md);
this package is the worked example. See `core/operators.ts` for the
`cipherstashEq` / `cipherstashIlike` handler shape.

### Control vs runtime tree-shaking architecture

The package publishes three runtime-relevant subpath entries —
`./control` (contract-space authoring + the codec lifecycle hook),
`./runtime` (envelope + SDK + codec runtime + `decryptAll`), and
`./middleware` (bulk-encrypt middleware) — and each composes
tree-shakably so a consumer pulling `./runtime` does not drag in the
EQL bundle SQL or the codec lifecycle hook (which would defeat the
runtime-bundle size budget and leak control-plane behavior into
runtime call paths) and a consumer pulling `./control` does not drag
in the runtime envelope, the SDK interface, the codec runtime, or
the bulk-encrypt middleware.

The split lives in the source layout: `src/exports/control.ts` only
imports from `src/core/{cipherstash-codec, contract, migrations,
descriptor-meta, eql-bundle, constants}.ts` and never from
`src/core/{envelope, codec-runtime, codec-metadata, sdk, decrypt-all}.ts`,
nor from `src/middleware/`. `src/exports/runtime.ts` /
`src/exports/middleware.ts` only import from the runtime-side core
modules (and the shared `constants.ts`). The
`test/bundling-isolation.test.ts` guard pins this byte-level —
asserting the entry `.mjs` files don't carry forbidden symbols and
that the transitively-reached chunk-file sets are disjoint modulo
the shared `constants-*.mjs` chunk.

The shared `constants-*.mjs` chunk is structurally permitted to live
in both planes — it carries pure literal constants (codec id, native
types, invariant ids) and no executable behavior.

The cross-package convention (source-level discipline + bundling-
isolation test, with rationale and assertion strategies) is documented
in the extension-packs reference doc at
[Extension-Packs-Naming-and-Layout § Tree-shakability between control
and runtime planes](../../../docs/reference/Extension-Packs-Naming-and-Layout.md);
this package is the worked example for that section.

### `decryptAll(rows, opts?)` is opt-in read-side amortization

The codec's `decode` returns `EncryptedString` envelopes that defer
their SDK round-trip until `envelope.decrypt(...)` is awaited; this
keeps SELECT plans cheap when consumers only need a subset of
encrypted columns or when consumers want to forward envelopes to a
downstream service without ever reading the plaintext.

`decryptAll(rows)` is the read-side amortization for the case where
the consumer DOES want plaintexts: it walks the result-set graph
(arrays, plain objects, nested envelopes; cycle-safe; skips already-
decrypted envelopes; passes over exotic containers like `Date` /
`Map` / `Set` / `Uint8Array`), partitions the discovered envelopes
by `(sdk identity, table, column)`, and issues one `bulkDecrypt` SDK
call per partition. The resolved plaintexts are cached back onto
each envelope's handle so subsequent `envelope.decrypt()` calls
return synchronously. Already-decrypted envelopes (write-side
envelopes from `EncryptedString.from(plaintext)`, or read-side
envelopes that already cached a plaintext) are not re-decrypted —
a re-run of `decryptAll` over a previously-decrypted result set is
a no-op.

The walker is intentionally narrow: traversing arbitrary graphs
(JS-side `Map` / `Set` / `Date` containers) is out of scope and
loud-skipped — embedding an `EncryptedString` inside a `Map` value
will not be discovered by the walker. Consumers needing such shapes
should call `envelope.decrypt(...)` directly.

## Behavioural invariants pinned by tests

The following user-facing behaviours are pinned by on-disk tests in
`test/`. This section is the canonical statement of what the package
guarantees; if you find yourself loosening one of these, that's the
signal to add a regression test alongside.

### Envelope + codec

- `EncryptedString.from(plaintext)` returns an envelope carrying the
  plaintext on a write-side handle whose ciphertext slot is unfilled
  until the bulk-encrypt middleware runs.
- `envelope.decrypt({ signal? })` returns plaintext via the SDK's
  single-cell `decrypt`; `signal` is forwarded by identity (the slot
  is omitted when `signal` is undefined, preserving
  `exactOptionalPropertyTypes`).
- After `decryptAll(...)` returns, every touched envelope's
  `decrypt()` returns the cached plaintext synchronously without
  consulting the SDK.
- The handle has no public TypeScript surface; pinned by a negative
  type test in `test/envelope.types.test-d.ts` and a runtime test
  asserting `Object.keys(envelope) === []` and `JSON.stringify(envelope)`
  produces the documented redacted placeholder.
- `cipherstash/string@1` codec registered with target type
  `eql_v2_encrypted` and zero traits; `decode(wire, ctx)` builds an
  envelope whose handle carries `(table, column)` from `ctx.column`;
  `encode(envelope, ctx)` reads the ciphertext from the envelope's
  handle (after middleware has populated it) and wraps it in the
  `eql_v2_encrypted` composite text format; `renderOutputType` returns
  `EncryptedString`; `RuntimeParameterizedCodecDescriptor` registered
  with the arktype `{ equality, freeTextSearch }` schema.

### Bulk-encrypt middleware

- For N rows × 1 cipherstash column sharing one routing key, exactly
  one `bulkEncrypt` SDK call.
- For multiple `(table, column)` routing keys, exactly one
  `bulkEncrypt` per group.
- The middleware writes ciphertexts back to envelope handles so the
  codec's `encode` reads them; `setHandleCiphertext` populates the
  handle without zeroing the plaintext slot.
- `ctx.signal` forwarded by identity to `bulkEncrypt`; cancellation
  observable downstream.
- Plaintext slot retained post-encrypt; the write-side envelope's
  `decrypt()` returns synchronously without invoking the SDK's
  single-cell `decrypt`.

### Operator lowering

- `email.cipherstashEq(plaintext)` lowers to
  `eql_v2.eq("table"."col", $N::eql_v2_encrypted)`.
- `email.cipherstashIlike(pattern)` lowers to
  `eql_v2.ilike("table"."col", $N::eql_v2_encrypted)`.
- `email.isNull()` lowers to `email IS NULL` directly; no EQL
  involvement, no parameter binding (the framework's `NullCheckExpr`
  bypasses the operator registry entirely).
- `email.isNotNull()` lowers to `email IS NOT NULL`; registering
  `cipherstashEq` / `cipherstashIlike` (not `eq` / `ilike`) leaves
  the framework's built-in handlers untouched on non-cipherstash
  columns. Combined with the codec declaring zero traits at all three
  sites (see `equality-trait-removal.test.ts`), `email.eq(...)` is a
  type error on cipherstash columns — the framework's trait-gated `=`
  lowering is unreachable, eliminating a wrong-SQL footgun on
  randomized EQL ciphertexts.

### `decryptAll` walker

- Walks recursively (objects, arrays, nested envelopes) and decrypts
  every `EncryptedString` it finds. Skips already-cached envelopes;
  passes over exotic containers (`Date`, `Map`, `Set`, `Uint8Array`);
  cycle-safe.
- For K envelopes across distinct routing keys, exactly one
  `bulkDecrypt` per `(sdk, table, column)` group.
- After return, every touched envelope's `decrypt()` returns the
  cached plaintext synchronously without consulting the SDK.
- `opts.signal` forwarded by identity to the SDK on every
  `bulkDecrypt` call. The slot is omitted from the SDK call when
  `opts.signal` is undefined.

### Cancellation envelope

- `RUNTIME.ABORTED` envelope wrapping at every cipherstash-internal
  phase (`bulk-encrypt`, `decrypt`, `decrypt-all`). Mirrors the
  framework's `runtimeError(RUNTIME_ABORTED, ...)` envelope shape
  exactly; only the legal `details.phase` string set widens (the
  cipherstash phase strings are not added to the framework's
  `RuntimeAbortedPhase` union). Codec encode/decode are intentionally
  left unwrapped — the framework's `encodeParams` / `decodeRow`
  per-cell race already raises `RUNTIME.ABORTED { phase: 'encode' |
  'decode' }` per ADR 207.

### Umbrella round-trips

- Live PSL e2e: `dbInit` + migration + insert (via
  `EncryptedString.from(...)`) + equality search via `cipherstashEq` +
  contains search via `cipherstashIlike` + `decryptAll` round-trip,
  exercised end-to-end against PGlite using a synthetic EQL bundle.
- TS contract authoring (`encryptedString({...})`) produces a
  `contract.json` byte-identical to the PSL version
  (`cipherstash.EncryptedString({...})`), pinned by the parity fixture
  under `test/integration/test/authoring/parity/cipherstash-encrypted-string/`.
- Bulk amortization: 1 × `bulkEncrypt` for 10 inserts; 1 ×
  `bulkDecrypt` for `decryptAll` over 10 rows in the same routing
  group.
- Nullable variant (`email: EncryptedString({ equality: true })?`):
  mixed-null insert bypasses null cells in the bulk-encrypt batch
  (1 × `bulkEncrypt` for the 5 non-null rows out of 10);
  `email.isNull()` / `email.isNotNull()` lower to
  `WHERE email IS NULL` / `WHERE email IS NOT NULL` directly via
  `NullCheckExpr` (not `eql_v2.eq`); the operator registry is not
  consulted; `decryptAll(mixedRows)` over 10 mixed-null rows issues
  exactly 1 × `bulkDecrypt` with 5 ciphertexts (the walker passes
  over null cells via the `value === null` short-circuit).
- `pnpm lint:deps` clean for the package's subtree.
- A worked example exists under `examples/cipherstash-integration/`
  exercising the insert → `cipherstashEq` → `cipherstashIlike` →
  `decryptAll` round-trip end-to-end with a demo SDK stub.
- Strict `dbInit` preserved — no `strictVerification: false` anywhere
  in the cipherstash subtree.
- Tree-shakable control vs runtime / middleware planes: `./control`
  does not pull `EncryptedString`, the SDK interface, the codec
  runtime, or the bulk-encrypt middleware; `./runtime` and
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
