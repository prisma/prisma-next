# Summary

Build the runtime side of `@prisma-next/extension-cipherstash`: the `EncryptedString` envelope class, its codec (post-#402 `RuntimeParameterizedCodecDescriptor<P>` shape), the bulk-encrypt middleware, the bulk-decrypt utility (`decryptAll`), the EQL bundle install via `databaseDependencies.init`, and the operator lowering for `eq` / `ilike` against encrypted columns. End-to-end-validated against live Postgres + EQL.

# Description

This task spec covers the *runtime* portion of Project 1's scope (see [Project 1 spec](../spec.md) and the [umbrella spec](../../spec.md)). It assumes the [middleware-param-transform](middleware-param-transform.spec.md) seam is in place and consumes it.

The shape is the **envelope-codec pattern**: an `EncryptedString` envelope class that crosses both directions of the codec boundary. Users construct envelopes for writes (`EncryptedString.from(plaintext)`) and receive envelopes from reads. Network I/O is amortized — the write side runs `bulkEncrypt` once per query (via middleware), the read side runs `bulkDecrypt` once per `decryptAll(rows)` call. Decryption is always explicit; the framework never silently materializes plaintext.

The pattern is intentionally extension-only: the framework offers no "encrypted column" primitive. The same pattern (envelope class, codec, middleware, bulk read utility) is the canonical shape for any future network-backed bulk-amortizable codec (Vault, AWS KMS, signed columns, schema-bound JSON validation against external services).

# Requirements

## Functional Requirements

### `EncryptedString` envelope class

Public surface — what users see:

```ts
export class EncryptedString {
  /** Construct from plaintext. The extension's middleware encrypts on write. */
  static from(plaintext: string): EncryptedString;

  /** Decrypt and return the plaintext. Cached after the first call (or after decryptAll). */
  decrypt(opts?: { signal?: AbortSignal }): Promise<string>;
}
```

The class owns its handle internally — closure / private field / WeakMap; the choice is an implementation detail. The handle carries:

- **Write side** (after `from(plaintext)`): plaintext + an empty `ciphertext` slot.
- **After bulk-encrypt middleware runs**: ciphertext + the column identity from `SqlCodecCallContext.column` + SDK routing keys (dataset, key id) needed for `bulkEncrypt`. The plaintext slot is overwritten with `undefined` for memory hygiene.
- **Read side** (after `codec.decode`): ciphertext + `{ table, column }` from `SqlCodecCallContext.column` + SDK routing keys needed for `bulkDecrypt`.

The handle has **no exported TypeScript surface**. Inside the package, codec / middleware / `decryptAll` reach into the handle via package-internal helpers (a private symbol on the envelope, a `WeakMap`, or `#`-prefixed fields — implementation choice).

### Codec — post-#402 shape

The codec body itself uses the existing `codec({ typeId, targetTypes, encode, decode, ... })` shape (see `packages/3-extensions/pgvector/src/core/codecs.ts` for the precedent — that file does not change shape between pre- and post-#402; the parameterization is plumbed *separately*).

```ts
// packages/3-extensions/cipherstash/src/core/codecs.ts
const cipherstashStringCodec = codec({
  typeId: 'cipherstash/string@1',
  targetTypes: ['eql_v2_encrypted'],   // EQL's JSONB-domain native type
  traits: ['equality'],
  renderOutputType: () => 'EncryptedString',
  encode: (envelope: EncryptedString, ctx: SqlCodecCallContext): unknown => {
    // Middleware has already populated handle.ciphertext.
    return getInternalHandle(envelope).ciphertext;
  },
  decode: (wire: unknown, ctx: SqlCodecCallContext): EncryptedString => {
    return EncryptedString.fromInternal({
      ciphertext: wire,
      table: ctx.column?.table,
      column: ctx.column?.name,
    });
  },
  meta: {
    db: { sql: { postgres: { nativeType: 'eql_v2_encrypted' } } },
  },
});
```

The parameterization (which search modes are enabled for *this column*) is plumbed via the runtime descriptor's `parameterizedCodecs` slot — same shape pgvector uses for `length`:

```ts
// packages/3-extensions/cipherstash/src/exports/runtime.ts
import { type as arktype } from 'arktype';

const encryptedStringParamsSchema = arktype({
  equality: 'boolean',
  freeTextSearch: 'boolean',
});

const parameterizedCodecDescriptors = [
  {
    codecId: 'cipherstash/string@1',
    paramsSchema: encryptedStringParamsSchema,
  },
] as const satisfies ReadonlyArray<
  RuntimeParameterizedCodecDescriptor<{ readonly equality: boolean; readonly freeTextSearch: boolean }>
>;
```

The `encode` body extracting `ciphertext` from the handle is the only "interesting" thing the codec does on the write side; the middleware did the actual encryption. The `decode` body constructs a fresh envelope wrapping the wire value plus the column identity.

### Bulk-encrypt middleware

```ts
// packages/3-extensions/cipherstash/src/middleware/bulk-encrypt.ts
export function bulkEncryptMiddleware(sdk: CipherstashSdk): SqlMiddleware {
  return {
    beforeExecute: async (plan, ctx, params) => {
      const targets: Array<{ ref: ParamRefHandle; plaintext: string; envelope: EncryptedString }> = [];
      for (const entry of params.entries()) {
        if (entry.codecId === 'cipherstash/string@1') {
          const envelope = entry.value as EncryptedString;
          targets.push({
            ref: entry.ref,
            plaintext: getInternalHandle(envelope).plaintext!,
            envelope,
          });
        }
      }
      if (targets.length === 0) return;

      const groups = groupByRoutingKey(targets);
      for (const [routingKey, group] of groups) {
        const ciphertexts = await sdk.bulkEncrypt({
          routingKey,
          values: group.map((t) => t.plaintext),
          signal: ctx.signal,
        });
        params.replaceValues(
          group.map((t, i) => {
            setHandleCiphertext(t.envelope, ciphertexts[i]!);
            return { ref: t.ref, newValue: t.envelope };
          }),
        );
      }
    },
  };
}
```

By the time `codec.encode(envelope, ctx)` runs, every envelope has its `handle.ciphertext` populated.

### `decryptAll` (bulk read-side)

```ts
// packages/3-extensions/cipherstash/src/exports/decrypt-all.ts
export async function decryptAll(
  rows: unknown,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const found: EncryptedString[] = [];
  walk(rows, (value) => {
    if (value instanceof EncryptedString && !isHandleDecrypted(value)) {
      found.push(value);
    }
  });
  if (found.length === 0) return;

  const groups = groupByRoutingKey(found);
  for (const [routingKey, group] of groups) {
    const ciphertexts = group.map((env) => getInternalHandle(env).ciphertext!);
    const plaintexts = await sdk.bulkDecrypt({ routingKey, ciphertexts, signal: opts?.signal });
    for (let i = 0; i < group.length; i++) {
      setHandlePlaintextCache(group[i]!, plaintexts[i]!);
    }
  }
}
```

After return, every touched envelope's `decrypt()` returns the cached plaintext synchronously.

### EQL bundle install via `databaseDependencies.init`

The control descriptor declares an `init` dependency that installs EQL by executing the vendored install SQL bundle. Same shape pgvector uses for `CREATE EXTENSION vector`, but the install SQL is the much-larger EQL bundle (~170 KB) sourced from the first-attempt repo's `eql-bundle.ts`:

```ts
// packages/3-extensions/cipherstash/src/exports/control.ts
const cipherstashDatabaseDependencies: ComponentDatabaseDependencies<unknown> = {
  init: [{
    id: 'postgres.extension.eql',
    label: 'Install EQL extension',
    install: [{
      id: 'eql.install',
      label: 'Install EQL bundle',
      summary: 'Installs the EQL Postgres extension bundle (encrypted-aware operators + cs_configuration_v2)',
      operationClass: 'additive',
      target: { id: 'postgres' },
      precheck: [{
        description: 'verify EQL is not already installed',
        sql: "SELECT NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cs_configuration_v2')",
      }],
      execute: [{
        description: 'install EQL bundle',
        sql: EQL_INSTALL_SQL,  // imported from ./eql-bundle.ts (vendored from first-attempt)
      }],
      postcheck: [{
        description: 'confirm EQL is installed',
        sql: "SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'eql_v2')",
      }],
    }],
  }],
};
```

Idempotent: precheck short-circuits if EQL is already installed. Same dependency-graph machinery the framework already runs for pgvector.

### Operator lowering: `eq` and `ilike`

The extension's `queryOperations` registers handlers for `eq` and `ilike` operators when the operand is a `cipherstash/string@1` column. Lowering produces EQL operator calls in the rendered SQL stream:

| User-facing | Standard SQL lowering | Cipherstash lowering |
|---|---|---|
| `where: { email: { equals: 'x' } }` | `email = $1` | `eql_v2.eq("email", eql_v2.encrypt($1, ...))` |
| `where: { email: { contains: 'x' } }` | `email ILIKE $1` | `eql_v2.ilike("email", eql_v2.encrypt($1, ...))` |
| `where: { email: null }` | `email IS NULL` | `email IS NULL` (no EQL involvement) |

The `null` case is critical: nullable encrypted columns must short-circuit on `null` before reaching the EQL operator (which doesn't accept null operands).

The exact EQL operator surface is captured in the first-attempt repo's `operation-templates.ts` (`reference/cipherstash/stack/packages/stack/src/prisma/core/operation-templates.ts`). This spec defers to that file for the canonical lowering — open question 1 below.

### Subpath exports

Mirrors `extension-pgvector` shape:

```text
packages/3-extensions/cipherstash/
├── src/
│   ├── core/
│   │   ├── envelope.ts            (EncryptedString class + handle helpers)
│   │   ├── codecs.ts              (cipherstashStringCodec)
│   │   ├── descriptor-meta.ts     (cipherstashPackMeta, queryOperations)
│   │   ├── routing.ts             (groupByRoutingKey, SDK shape adapters)
│   │   └── eql-bundle.ts          (vendored EQL install SQL)
│   ├── middleware/
│   │   └── bulk-encrypt.ts
│   └── exports/
│       ├── index.ts               (EncryptedString, decryptAll)
│       ├── column-types.ts        (encryptedString factory for TS contracts)
│       ├── runtime.ts             (SqlRuntimeExtensionDescriptor with parameterizedCodecs)
│       ├── control.ts             (SqlControlExtensionDescriptor with databaseDependencies)
│       └── middleware.ts          (bulkEncryptMiddleware factory)
└── package.json                   (peer deps: SDK, sql-relational-core, family-sql, framework-components)
```

## Non-Functional Requirements

- **Bulk amortization is the cost contract.** Per-query encrypt collapses to one SDK call per routing key (typically K=1). `decryptAll` collapses to one SDK call per routing key.
- **Per-cell `decrypt()` is acceptable but not optimal.** Users opting out of bulk read-side processing pay one SDK round-trip per call. Documented expectation; no batching at the single-cell level.
- **Cancellation is wired everywhere.** `ctx.signal` is forwarded to the SDK on every call (single decrypt, bulk encrypt, bulk decrypt). Already-aborted at entry surfaces `RUNTIME.ABORTED` with phase tag per ADR 207.
- **No regression in the no-cipherstash hot path.** When no cipherstash columns are in a query, the bulk-encrypt middleware's `entries()` walk finds zero targets and returns without any allocation beyond the empty `targets` array.
- **The handle is a true secret.** No public TypeScript surface; users cannot import a handle type, and the envelope's public methods don't expose it. `JSON.stringify(envelope)` produces a non-revealing placeholder (open question 4 below).

## Non-goals

- **Other column types.** `EncryptedNumber`, `EncryptedDate`, `EncryptedBoolean`, `EncryptedJson` are Project 2.
- **Other operators.** `orderAndRange` (`gt`/`gte`/`lt`/`lte`), `searchableJson` are Project 2.
- **Streaming-time decryption.** Users decrypt per-cell or via post-buffering `decryptAll`. The framework's streaming path doesn't try to decrypt mid-iteration.
- **Selective-by-column `decryptAll`.** First-pass walks every envelope it finds. Selective convenience is a follow-on if there's demand.
- **KMS provider abstraction.** This package is CipherStash-specific.
- **Re-implementing the CipherStash SDK.** Wraps the existing SDK; bulk surface mismatches escalate to the CipherStash team.
- **Automatic plaintext zeroing on the user's `from(plaintext)` argument.** The middleware overwrites the handle's plaintext slot post-encrypt; the user's original `string` argument lifecycle is the user's concern.
- **Re-encryption migration.** Adopting CipherStash for an existing column requires a one-off data migration; not a primitive in this spec.

# Acceptance Criteria

## Package shape

- [ ] **AC-PKG1**: `@prisma-next/extension-cipherstash` ships from `packages/3-extensions/cipherstash/` with subpath exports per the layout above.
- [ ] **AC-PKG2**: `pnpm lint:deps` passes; the extension imports only from public framework / SQL family / family-extension surfaces.
- [ ] **AC-PKG3**: Peer-deps declared correctly; resolution works against a fresh consumer install.

## `EncryptedString` envelope class

- [ ] **AC-ENV1**: `EncryptedString.from(plaintext)` returns an envelope carrying the plaintext + an unfilled handle.
- [ ] **AC-ENV2**: `envelope.decrypt({ signal? })` returns the original plaintext via the SDK's single-cell decrypt; signal forwarded to the SDK.
- [ ] **AC-ENV3**: After `decryptAll`, `envelope.decrypt()` returns the cached plaintext synchronously without touching the SDK.
- [ ] **AC-ENV4**: The handle has **no public TypeScript surface** — users cannot import a handle type, and the envelope's public methods don't expose it. Negative type test pins this.

## Codec

- [ ] **AC-CODEC1**: `cipherstash/string@1` registered with target type `eql_v2_encrypted`, traits `['equality']`.
- [ ] **AC-CODEC2**: `decode(ciphertext, ctx)` constructs an envelope whose handle carries `{ table: ctx.column.table, column: ctx.column.name }`. Verified via the [TML-2330](https://linear.app/prisma-company/issue/TML-2330) ctx plumbing.
- [ ] **AC-CODEC3**: `encode(envelope, ctx)` extracts the ciphertext from the envelope's handle. Verified against a fixture where the middleware has run.
- [ ] **AC-CODEC4**: `renderOutputType` produces `EncryptedString` so emit-path output reflects the envelope type.
- [ ] **AC-CODEC5**: `RuntimeParameterizedCodecDescriptor` registered for `cipherstash/string@1` with arktype schema for `{ equality, freeTextSearch }`.

## Bulk-encrypt middleware

- [ ] **AC-MW1**: For a plan inserting N rows × 1 cipherstash column sharing one routing key, exactly **one** `bulkEncrypt` call is issued (verified with a mock SDK).
- [ ] **AC-MW2**: For multiple routing keys, exactly one `bulkEncrypt` per group.
- [ ] **AC-MW3**: The middleware forwards `ctx.signal` to the SDK; an aborted signal at `beforeExecute` entry surfaces `RUNTIME.ABORTED { phase: 'beforeExecute' }`.
- [ ] **AC-MW4**: After the middleware runs, `codec.encode` receives ciphertext via the envelope's handle.
- [ ] **AC-MW5**: After the middleware runs, the handle's plaintext slot is `undefined` (memory hygiene).

## `decryptAll`

- [ ] **AC-DEC1**: Walks recursively (objects, arrays, nested envelopes) and decrypts every `EncryptedString` it finds.
- [ ] **AC-DEC2**: For K envelopes across distinct routing keys, exactly one `bulkDecrypt` per group.
- [ ] **AC-DEC3**: After return, every touched envelope's `decrypt()` returns the cached plaintext synchronously.
- [ ] **AC-DEC4**: `opts.signal` forwarded to the SDK; aborted signals surface `RUNTIME.ABORTED` with phase tag (open question 5 below).

## EQL bundle install

- [ ] **AC-INSTALL1**: `databaseDependencies.init` declares the EQL install entry per the schema above.
- [ ] **AC-INSTALL2**: Integration test against a fresh Postgres database: `dbInit` succeeds; `eql_v2` schema is reachable; `cs_configuration_v2` table exists.
- [ ] **AC-INSTALL3**: Idempotency: re-running `dbInit` against a DB with EQL already installed short-circuits via the precheck — no error.

## Operator lowering

- [ ] **AC-OP1**: `findMany({ where: { email: { equals: 'x' } } })` against a `cipherstash/string@1` column lowers to the EQL `eq` operator (verified by SQL snapshot).
- [ ] **AC-OP2**: `findMany({ where: { email: { contains: 'x' } } })` lowers to the EQL `ilike` operator.
- [ ] **AC-OP3**: `findMany({ where: { email: null } })` lowers to `email IS NULL` (does **not** wrap in any EQL operator).
- [ ] **AC-OP4**: For non-cipherstash columns, `eq` and `ilike` lowering is unchanged (no regression).

## End-to-end integration

- [ ] **AC-E2E1**: Round-trip integration test against live Postgres + EQL. Insert via `db.insert(User, { email: EncryptedString.from('alice@example.com') })`. Read via `findMany({ where: { email: { equals: 'alice@example.com' } } })` returns the row. `findMany({ where: { email: { contains: 'alice' } } })` returns the row. `decryptAll(rows)` materializes plaintext.
- [ ] **AC-E2E2**: Bulk amortization verified end-to-end with mock SDK call counters: insert 10 rows → one `bulkEncrypt` call. `decryptAll` over 10-row result set → one `bulkDecrypt` call.
- [ ] **AC-E2E3**: Nullable round-trip: insert 5 rows with mixed `null` / non-null emails; read all back; null-row's `email` is `null` (not an envelope), non-null rows' `email` are envelopes that decrypt correctly.

## Documentation & ADRs

- [ ] **AC-DOC1**: Package `README.md` documents the envelope-codec pattern, `decrypt()` vs `decryptAll` choice, EQL install prerequisites, security model.
- [ ] **AC-DOC2**: A worked example exists in `examples/`.
- [ ] **AC-DOC3**: An ADR (or extension to ADR 207) records the envelope-codec pattern as the canonical approach for any network-backed bulk-amortizable codec.

# Other Considerations

## Security

See umbrella spec — no additional security concerns at the task level beyond what's enumerated there. Specifically: handle is package-private with no public TS surface, plaintext is overwritten on the handle post-encrypt, EQL install requires DB superuser (documented).

## Cost

EQL bundle install is a one-time DDL during `dbInit` (~170 KB SQL, ~1-2s execution). Per-query runtime cost is dominated by ZeroKMS round-trips, collapsed to O(1) by the bulk patterns.

## Observability

Mock SDK exposes call counters for tests. Real-runtime observability is out of scope for Project 1.

## Data Protection

See umbrella spec.

# References

- [Project 1 spec](../spec.md)
- [Umbrella spec](../../spec.md)
- [middleware-param-transform task spec](middleware-param-transform.spec.md) — direct dependency for the bulk-encrypt middleware
- [ADR 207 — codec call context](../../../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md) (forthcoming with [PR #400](https://github.com/prisma/prisma-next/pull/400))
- [ADR 208 — unified `CodecDescriptor<P>`](../../../../docs/architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md) (forthcoming with [PR #402](https://github.com/prisma/prisma-next/pull/402))
- [pgvector extension](../../../../packages/3-extensions/pgvector/) — direct precedent for codec + parameterized descriptor + `databaseDependencies.init` shape
- [First-attempt EQL bundle](../../../../reference/cipherstash/stack/packages/stack/src/prisma/core/eql-bundle.ts) — vendored install SQL
- [First-attempt operation templates](../../../../reference/cipherstash/stack/packages/stack/src/prisma/core/operation-templates.ts) — canonical EQL operator lowering reference
- [First-attempt database dependencies](../../../../reference/cipherstash/stack/packages/stack/src/prisma/core/database-dependencies.ts) — precedent for the install entry shape

# Open Questions

1. **Canonical EQL operator lowering shape.** The first-attempt's `operation-templates.ts` is the source-of-truth for the exact SQL function calls (`eql_v2.eq` vs `eql_v2.encrypted_eq` etc.). This spec defers to that file but flags the lift as a concrete task.
2. **Routing-key surface in user config.** ZeroKMS bulk calls group by `(dataset, keyId)`. Currently the handle is expected to derive routing keys from `(table, column)` plus extension-level config; whether per-column key-id override surfaces in the `encryptedString({...})` factory is open. Default: no per-column override; derived from `(table, column)`.
3. **Phase tag for `decryptAll` aborts.** `decryptAll` runs *outside* a `runtime.execute()` call, so phase tags `'encode'` / `'decode'` / `'stream'` don't fit cleanly. Default: `'decode'` (user's mental model is "decode-side"). Consider inventing `'decrypt-all'` if we want stricter attribution.
4. **`JSON.stringify(envelope)` behavior.** Should it produce a placeholder (`{ "$encryptedString": "<opaque>" }`), throw, or return `undefined` (which `JSON.stringify` treats as field omission)? Default: placeholder. Confirm.
5. **Plaintext memory hygiene strictness.** The middleware overwrites the handle's plaintext slot post-encrypt. Should the envelope class additionally implement explicit zeroization (e.g. `envelope.dispose()`) for users with hardened secrets-hygiene requirements? Default: no — lifecycle is GC-driven, dispose is a phase-2 add-on.
6. **`expandNativeType` for `eql_v2_encrypted`.** Pgvector's `expandNativeType` produces `vector(1536)` from `nativeType: 'vector'` + `typeParams: { length: 1536 }`. Cipherstash's `eql_v2_encrypted` is a fixed JSONB-domain type; the search-mode params don't affect the column's DDL type expression — they affect runtime behavior + the migration-factories DDL. Is `expandNativeType` a no-op for cipherstash? Default: yes, return `nativeType` unchanged.

# Alternatives Considered

## Per-cell codec without envelopes

The codec returns plaintext directly from `decode(wire)` and the middleware decrypts on every read. Users see `string`, no envelope class.

**Rejected** because it breaks bulk amortization on the read side: the codec is per-cell and the runtime races dispatches concurrently — there's no place to coalesce. Read-side bulk decryption requires either streaming-time coalescing (rejected as a non-goal), buffering inside the codec (the microtask-coalescer pattern, see next), or returning envelopes for explicit decryption (the chosen design).

## Microtask-coalescing batcher inside the codec body

The CipherStash team's first integration. The codec body owns a shared queue and a `Promise.resolve().then(...)` flush; per-cell calls enqueue, the microtask flushes once per JS turn with one bulk SDK call.

**Rejected** because the codec body ends up owning concurrency control, batch sizing, abort handling, and SDK error attribution — squeezed into the per-cell shape that doesn't fit any of them. Also opaque: future extensions implementing similar (Vault, AWS KMS, signing) each rediscover the same workaround. Moving the bulk dispatch to the middleware layer ([TML-2359](https://linear.app/prisma-company/issue/TML-2359)) and the read-side coalescing to a standalone utility (`decryptAll`) keeps each concern at the right layer.

## Result-set transformer instead of envelopes

A wrapper utility users apply to their result set: `for await (const row of decrypt(db.select(...).execute()))` — it runs bulk decryption and yields plaintext-typed rows.

**Rejected** because it doesn't fit streaming consumption (the transformer would have to buffer the whole result set before yielding the first row to enable bulk decryption), and because the user's row type would need to switch between "encrypted view" and "decrypted view" — pushing the type-shape concern into the consumer's awareness of which transformer they used. The envelope class keeps the type stable (`EncryptedString` always), and the user picks decrypt timing explicitly.

## A unified `KmsProvider` abstraction across CipherStash, Vault, AWS KMS

Define a generic `KmsProvider` interface; `@prisma-next/extension-kms` implements the envelope shape against an injected provider.

**Rejected for this phase.** Each SDK has different bulk-call shapes, different routing-key semantics, different error taxonomies, different cancellation contracts. A generic abstraction premature-optimizes a shape we've only validated against one SDK. The pattern (envelope class, codec, middleware, `decryptAll`) is the abstraction; the implementations stay per-SDK. If multiple KMS extensions converge on a clean common shape, factor a `@prisma-next/extension-kms-base` later.

## Lazy decryption on field access

Implement `EncryptedString` with a `Proxy` or getter that triggers decryption on first property access (`user.email + ''` triggers `decrypt()`).

**Rejected** because it makes decryption implicit — users can't tell when an `await` is happening, can't reason about when the SDK is being called, can't bulk-amortize. Explicit `await envelope.decrypt()` is the clearer mental model and matches the framework's "always-await codec methods" boundary established by [ADR 204](../../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md).

## Public handle type

Export the handle's TypeScript shape so users can serialize / deserialize / inspect.

**Rejected** because the handle is implementation-detail of the SDK integration. Users who need cross-process envelope transport build their own serialization on top of `decrypt() → string → encrypt-on-other-side`.

## Pre-#402 codec API

Author the codec against the pre-#402 codec interface (no separate `RuntimeParameterizedCodecDescriptor` plumbing).

**Rejected** because the search-mode flags (`equality`, `freeTextSearch`) are runtime-relevant codec parameters, and the post-#402 machinery is the framework-supported way to plumb them. Riding on the same shape pgvector uses for `length` keeps the extension consistent with framework precedent and avoids a future migration.
