# cipherstash-extension

## TL;DR

Ship `@prisma-next/extension-cipherstash`: a CipherStash/ZeroKMS-backed encrypted-column extension built on the **envelope-codec pattern**. One envelope class per encrypted column type (`EncryptedString`, `EncryptedJson`, etc.) crosses both directions — users construct envelopes from plaintext for writes and call `await envelope.decrypt()` (or bulk-decrypt utilities) for reads. Network I/O is amortized end-to-end: write side uses bulk-encrypt middleware ([TML-2359](https://linear.app/prisma-company/issue/TML-2359)) so all per-query plaintexts coalesce into one `bulkEncrypt({ signal })`; read side returns envelopes carrying internal handles so user code can call `decryptAll(rows, { signal })` to coalesce all per-result-set ciphertexts into one `bulkDecrypt({ signal })`.

The extension is the **first real consumer** of the codec call context ([TML-2330](https://linear.app/prisma-company/issue/TML-2330)) and middleware param transform ([TML-2359](https://linear.app/prisma-company/issue/TML-2359)) seams. The envelope-codec pattern it establishes is the recommended shape for any future network-backed bulk-amortizable codec (Vault, AWS KMS, signed columns, schema-bound JSON validation against external services).

## Grounding example

A user adds a CipherStash-encrypted column to a Prisma Next contract:

```ts
import { encryptedString } from '@prisma-next/extension-cipherstash/column-types';

const User = model('User', {
  fields: {
    id: field.column(int4Column).id(),
    email: field.column(encryptedString),
  },
});
```

The contract emitter renders `User.email` as `EncryptedString` (not `string`). At runtime:

```ts
import { EncryptedString, decryptAll } from '@prisma-next/extension-cipherstash';

// Write — user constructs an envelope from plaintext.
await db.insert(User, {
  email: EncryptedString.from('alice@example.com'),
}).execute({ signal });

// Read, single-cell decrypt.
for await (const user of db.select(User).execute({ signal })) {
  console.log(await user.email.decrypt({ signal }));
}

// Read, bulk-decrypt — collect a window, then bulk-decrypt in place.
const users = await collectAll(db.select(User).execute({ signal }));
await decryptAll(users, { signal });
console.log(users[0]!.email);  // string (cached, synchronous)
```

The `EncryptedString` envelope crosses both directions: the user writes one (carrying plaintext) and reads one (carrying ciphertext). Network calls are bulk on both sides — the extension's middleware coalesces write-side encrypts; `decryptAll` coalesces read-side decrypts.

## Decision

The extension is built on three load-bearing choices:

- **Envelope class on both sides.** The user-facing input and output type for any CipherStash-encrypted column is an envelope class (`EncryptedString`, `EncryptedJson`, …). Users construct envelopes for writes (`EncryptedString.from(plaintext)`) and receive envelopes from reads. The framework never sees raw plaintext after a write call site, and never returns raw plaintext from a read without an explicit `decrypt()` or `decryptAll` call.

- **Internal handle, no public TypeScript surface.** The envelope class owns its handle internally — closure / private field / WeakMap; the choice is an implementation detail. The handle bundles whatever CipherStash needs (plaintext or ciphertext, column identity from `SqlCodecCallContext.column`, SDK routing keys). Users never import the handle type and never observe its shape; their only interaction with an envelope is `from()` / `decrypt()`.

- **Bulk on both sides via existing seams; codec is a thin shell.** Write-side encryption runs as bulk-encrypt middleware (consuming [TML-2359](https://linear.app/prisma-company/issue/TML-2359)'s `ParamRefMutator`); by the time `codec.encode` runs, the envelope's handle already carries ciphertext, and encode is identity. Read-side `codec.decode` constructs a fresh envelope wrapping the wire ciphertext + the column identity from `SqlCodecCallContext.column`; bulk decryption is a standalone post-buffering utility (`decryptAll`), not a codec or runtime concern.

Decryption is **always explicit** — never lazy on field access, never streamed mid-iteration. Users decide when to materialize plaintext via `await envelope.decrypt()` per cell or `await decryptAll(rows)` for a buffered result set.

## Why

CipherStash's ZeroKMS is a network-backed encryption service: every encrypt and decrypt is an HTTPS round-trip that's efficient only when amortized across many ciphertexts in one bulk call. The framework's per-cell `codec.encode` / `codec.decode` boundary doesn't naturally support bulk semantics — it dispatches per-cell and races concurrently via `Promise.all`, but offers no coalescing.

The CipherStash team's first integration attempt (their `cipherstash/stack` repo, `prisma-next` branch) worked around this by stuffing a microtask-coalescing batcher inside the codec body. That works but is operationally awkward: the codec body owns concurrency control, batch sizing, abort handling, and SDK-specific error attribution, all squeezed into the per-cell dispatch shape. Three concrete pain points fed into the design here:

- **Decode-side column identity** — the codec's `decode(wire)` had no way to know which `(table, column)` the cell came from, so it couldn't construct a return value that carries enough context to participate in bulk-decrypt later. Now plumbed by [TML-2330](https://linear.app/prisma-company/issue/TML-2330) / [ADR 207](../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md).
- **Per-query cancellation** — codec calls had no `AbortSignal` to forward to the SDK, so cancelled queries kept consuming KMS budget until the in-flight call completed. Resolved by the same ADR.
- **Bulk dispatch at the right layer** — per-cell `Promise.all` codec dispatch fans out to N concurrent network calls per query × M codec'd cells per row. Solved at the middleware layer rather than the codec layer (per [TML-2359](https://linear.app/prisma-company/issue/TML-2359) / `projects/middleware-param-transform/spec.md`); the codec stays per-cell and unchanged.

The envelope-codec pattern composes the three resolutions into a clean user-facing surface where bulk amortization is automatic on both sides and decryption is always explicit.

## How it works

### The envelope class

```ts
// Public surface — what users see.
export class EncryptedString {
  /** Construct from plaintext. The extension's middleware encrypts on write. */
  static from(plaintext: string): EncryptedString;

  /** Decrypt and return the plaintext. Cached after the first call (or after decryptAll). */
  decrypt(opts?: { signal?: AbortSignal }): Promise<string>;
}
```

The class owns its handle internally. The handle carries:

- **Write side** (after `from(plaintext)`): plaintext + an empty `ciphertext` slot.
- **After bulk-encrypt middleware runs**: plaintext + ciphertext (or just ciphertext, if the middleware discards plaintext for memory hygiene).
- **Read side** (after `codec.decode`): ciphertext + `{ table, column }` from `SqlCodecCallContext.column` + any SDK routing keys (dataset, key id) needed for `bulkDecrypt`.

The handle has **no exported type**. Inside the package, codec / middleware / `decryptAll` reach into the handle via package-internal helpers (a private symbol on the envelope, a `WeakMap`, or `#`-prefixed fields — implementation choice).

`EncryptedJson<TShape>`, `EncryptedNumber`, etc. ship as parallel classes when added; they share a common base for handle storage and single-cell decrypt and differ only in their plaintext type.

### The codec

```ts
// packages/3-extensions/cipherstash/src/core/codecs.ts
const cipherstashStringCodec = codec({
  typeId: 'cipherstash/string@1',
  targetTypes: ['text'],
  traits: ['equality'],

  encode: (envelope: EncryptedString, ctx: SqlCodecCallContext): string => {
    // Middleware has already populated handle.ciphertext.
    return getInternalHandle(envelope).ciphertext;
  },

  decode: (wire: string, ctx: SqlCodecCallContext): EncryptedString => {
    // ctx.column is supplied by the runtime per ADR 207. The handle captures
    // it so decryptAll can group by routing key.
    return EncryptedString.fromInternal({
      ciphertext: wire,
      table: ctx.column?.table,
      column: ctx.column?.name,
    });
  },

  renderOutputType: () => 'EncryptedString',
});
```

`encode` extracting `ciphertext` from the handle is the only "interesting" thing the codec does on the write side; the middleware did the actual encryption. `decode` constructs a fresh envelope wrapping the wire value plus the column identity. `renderOutputType` makes the no-emit and emit paths both render `EncryptedString` for the user-facing row type.

### The bulk-encrypt middleware

```ts
// packages/3-extensions/cipherstash/src/middleware/bulk-encrypt.ts
export function bulkEncryptMiddleware(sdk: CipherstashSdk): SqlMiddleware {
  return {
    beforeExecute: async (plan, ctx, params) => {
      const targets: Array<{ ref: ParamRefHandle; plaintext: string; envelope: EncryptedString }> = [];
      for (const entry of params.entries()) {
        if (CIPHERSTASH_CODEC_IDS.has(entry.codecId ?? '')) {
          const envelope = entry.value as EncryptedString;
          targets.push({
            ref: entry.ref,
            plaintext: getInternalHandle(envelope).plaintext,
            envelope,
          });
        }
      }
      if (targets.length === 0) return;

      // Group by SDK routing key (dataset + key id) — bulkEncrypt requires it.
      const groups = groupByRoutingKey(targets);
      for (const [routingKey, group] of groups) {
        const ciphertexts = await sdk.bulkEncrypt({
          routingKey,
          values: group.map((t) => t.plaintext),
          signal: ctx.signal,
        });
        // Update each envelope's handle in place + write back via the mutator.
        params.replaceValues(
          group.map((t, i) => {
            setHandleCiphertext(t.envelope, ciphertexts[i]);
            return { ref: t.ref, newValue: t.envelope };
          }),
        );
      }
    },
  };
}
```

By the time `codec.encode(envelope, ctx)` runs, every envelope in the params has its `handle.ciphertext` populated. The codec extracts it; encode is constant-time per cell.

### `decryptAll` (bulk read-side)

```ts
// packages/3-extensions/cipherstash/src/exports/decrypt-all.ts
export async function decryptAll(
  rows: unknown,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  // 1. Walk rows recursively (objects, arrays, nested), collect every envelope.
  const found: EncryptedString[] = [];
  walk(rows, (value) => {
    if (value instanceof EncryptedString && !isHandleDecrypted(value)) {
      found.push(value);
    }
  });
  if (found.length === 0) return;

  // 2. Group by SDK routing key from each handle's column identity.
  const groups = groupByRoutingKey(found);

  // 3. One bulk SDK call per group.
  for (const [routingKey, group] of groups) {
    const ciphertexts = group.map((env) => getInternalHandle(env).ciphertext);
    const plaintexts = await sdk.bulkDecrypt({ routingKey, ciphertexts, signal: opts?.signal });
    for (let i = 0; i < group.length; i++) {
      setHandlePlaintextCache(group[i]!, plaintexts[i]!);
    }
  }
}
```

After `decryptAll` returns, every envelope it touched has its plaintext cached on the handle. Subsequent `envelope.decrypt()` calls return the cached value synchronously — no SDK roundtrip. The walker handles arbitrary nested shapes (envelopes inside arrays, inside object properties, inside other envelopes) so users can pass result sets, single rows, or any structure carrying envelopes.

### TypeScript shape end-to-end

The contract emitter / no-emit path renders a column with codec `cipherstash/string@1` as `EncryptedString` (via `renderOutputType`). The user's row type at the call site is:

```ts
type UserRow = { id: number; email: EncryptedString };
```

…which is what `db.select(User)` yields per row. The user must explicitly `await user.email.decrypt()` or `await decryptAll(rows)` to materialize plaintext. The type system never lies — there's no `string | EncryptedString` union or implicit coercion.

### Cancellation

Both the middleware (write side) and `decryptAll` (read side) forward `ctx.signal` (or `opts.signal`) to the underlying SDK call. Aborted signals stop talking to ZeroKMS at the wire level, returning the network budget. The framework runtime's separate cancellation path ([ADR 207](../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md)) is unaffected — same `signal` reference, same identity guarantee.

### Package layout

```text
packages/3-extensions/cipherstash/
├── src/
│   ├── core/
│   │   ├── envelope.ts        (EncryptedString, EncryptedJson)
│   │   ├── handle.ts          (internal handle, internal helpers)
│   │   ├── codecs.ts          (cipherstash/string@1, cipherstash/json@1)
│   │   └── routing.ts         (groupByRoutingKey, SDK shape adapters)
│   ├── middleware/
│   │   └── bulk-encrypt.ts    (the middleware factory)
│   ├── exports/
│   │   ├── index.ts           (envelope classes, decryptAll, factory)
│   │   ├── column-types.ts    (encryptedString, encryptedJson)
│   │   ├── codec-types.ts     (codec id constants, Codec exports)
│   │   └── middleware.ts      (bulkEncryptMiddleware factory)
│   └── decrypt-all.ts
└── package.json               (peer deps: SDK, sql-relational-core, framework-components)
```

Subpath exports mirror the existing `extension-pgvector` shape.

## What this enables

- **End-to-end bulk amortization for KMS-backed columns.** A query inserting N rows × M cipherstash columns issues exactly one `bulkEncrypt` call per SDK routing key. A read-side `decryptAll(rows)` issues exactly one `bulkDecrypt` call per group. Per-query KMS round-trips collapse from O(N × M) to O(K) where K is the number of distinct routing keys (typically K = 1 for a single dataset).
- **Reusable pattern for future extensions.** Vault-backed encryption, AWS KMS, signed columns, schema-bound JSON validation against external services — same envelope-class-on-both-sides shape. The pattern is documented in this project's close-out and migrated into a durable doc for future extension authors.
- **Selective decryption without framework involvement.** Users who want "decrypt only `email` fields" walk their result set themselves and call `envelope.decrypt()` on the matched cells. `decryptAll` is the catch-all convenience; selectivity is user-side.

## Non-goals

- **No streaming-time decryption.** Decryption is always explicit. The framework's streaming path doesn't try to decrypt envelopes mid-iteration; users either call `decrypt()` per cell or buffer first then call `decryptAll`.
- **No selective-by-column `decryptAll`.** First-pass utility decrypts every envelope it finds. Users wanting "only `email`, leave `phone` alone" write their own walker. Selective convenience is a phase-2 add-on if there's demand.
- **No KMS provider abstraction.** This package is CipherStash-specific. A future `@prisma-next/extension-vault`, `@prisma-next/extension-aws-kms` follow the same pattern but ship as separate packages with their own envelope classes. No shared KMS interface this round.
- **No re-implementation of the CipherStash SDK.** The extension wraps the existing SDK. If the SDK lacks `bulkEncrypt` / `bulkDecrypt` shape that fits the middleware contract cleanly, that's an SDK-side change to coordinate with the CipherStash team.
- **No migration support for existing schemas.** Adopting CipherStash for an existing column requires a data migration (re-encrypt existing rows). Users handle it via Prisma Next's migration tooling and a one-off script. A "rotate codec" migration primitive can land later.
- **No automatic plaintext zeroing.** `EncryptedString.from(plaintext)` keeps the plaintext alive as long as the envelope object. Users with strict secrets-hygiene requirements dispose envelopes promptly. Documented expectation.

## Acceptance criteria

### Package shape

- [ ] **AC-PKG1**: `@prisma-next/extension-cipherstash` ships from `packages/3-extensions/cipherstash/` with subpath exports per the layout above.
- [ ] **AC-PKG2**: `pnpm lint:deps` passes; the extension imports only from public framework / SQL family / family-extension surfaces.
- [ ] **AC-PKG3**: Peer-deps declared correctly; resolution works against a fresh consumer install.

### Envelope classes

- [ ] **AC-ENV1**: `EncryptedString.from(plaintext)` returns an envelope carrying the plaintext + an unfilled handle.
- [ ] **AC-ENV2**: `envelope.decrypt({ signal? })` returns the original plaintext via the SDK's single-cell decrypt; signal forwarded to the SDK.
- [ ] **AC-ENV3**: After `decryptAll`, `envelope.decrypt()` returns the cached plaintext synchronously without touching the SDK.
- [ ] **AC-ENV4**: The handle has **no public TypeScript surface** — users cannot import a handle type, and the envelope's public methods don't expose it. Negative type test pins this.
- [ ] **AC-ENV5**: At least two envelope types ship: `EncryptedString`, `EncryptedJson<TShape>`.

### Codec

- [ ] **AC-CODEC1**: `cipherstash/string@1` registered with target type `text`, traits as appropriate.
- [ ] **AC-CODEC2**: `decode(ciphertext, ctx)` constructs an envelope whose handle carries `{ table: ctx.column.table, column: ctx.column.name }`. Verified via the [TML-2330](https://linear.app/prisma-company/issue/TML-2330) ctx plumbing.
- [ ] **AC-CODEC3**: `encode(envelope, ctx)` extracts the ciphertext from the envelope's handle. Verified against a fixture where the middleware has run.
- [ ] **AC-CODEC4**: `renderOutputType` produces `EncryptedString` (etc.) so emit-path output reflects the envelope type.

### Bulk-encrypt middleware

- [ ] **AC-MW1**: For a plan inserting N rows × M cipherstash columns sharing one routing key, exactly **one** `bulkEncrypt` call is issued (verified with a mock SDK).
- [ ] **AC-MW2**: For multiple routing keys, exactly one `bulkEncrypt` per group.
- [ ] **AC-MW3**: The middleware forwards `ctx.signal` to the SDK; an aborted signal at `beforeExecute` entry surfaces `RUNTIME.ABORTED { phase: 'beforeExecute' }`.
- [ ] **AC-MW4**: After the middleware runs, `codec.encode` receives ciphertext via the envelope's handle.

### `decryptAll`

- [ ] **AC-DEC1**: Walks recursively (objects, arrays, nested envelopes) and decrypts every `EncryptedString` it finds.
- [ ] **AC-DEC2**: For K envelopes across distinct routing keys, exactly one `bulkDecrypt` per group.
- [ ] **AC-DEC3**: After return, every touched envelope's `decrypt()` returns the cached plaintext synchronously.
- [ ] **AC-DEC4**: `opts.signal` forwarded to the SDK; aborted signals surface `RUNTIME.ABORTED` (phase tag — see open question below).

### End-to-end integration

- [ ] **AC-E2E1**: Round-trip test (write → read → decrypt) against a stub queryable + mock SDK preserves plaintext.
- [ ] **AC-E2E2**: Same test verifies bulk amortization: one network call per direction.
- [ ] **AC-E2E3**: At least one example app under `examples/` demonstrates the pattern with realistic shapes.

### Documentation

- [ ] **AC-DOC1**: Package `README.md` documents the envelope-codec pattern, `decrypt()` vs `decryptAll` choice, setup steps.
- [ ] **AC-DOC2**: A worked example exists in `examples/`.
- [ ] **AC-DOC3**: An ADR (or extension to ADR 207) records the envelope-codec pattern as the canonical approach for any network-backed bulk-amortizable codec.

## Open questions

1. **Which CipherStash SDK to depend on?** The team has multiple SDKs; pick the one with the cleanest `bulkEncrypt` / `bulkDecrypt` exports. Coordinate with the CipherStash team if the current SDK lacks bulk surface.
2. **Routing-key semantics in the handle.** Different SDK versions key bulk calls by `(dataset, keyId)` or by `(dataset)` alone. Settle by reading the current SDK's signatures before coding `groupByRoutingKey`.
3. **Phase tag for `decryptAll` aborts.** `decryptAll` runs *outside* a `runtime.execute()` call, so phase tags `'encode'` / `'decode'` / `'stream'` don't fit cleanly. Default: `'decode'` (user's mental model is "decode-side"). Consider inventing `'decrypt-all'` if we want stricter attribution.
4. **`encryptedString` storage type.** Postgres `text` (base64-encoded ciphertexts) or `bytea` (raw bytes). Default: `text`. Confirm with the CipherStash team's recommended storage.
5. **`EncryptedJson` codec id.** Own codec id (`cipherstash/json@1`, `targetTypes: ['jsonb']`) — does **not** compose with `pg/json@1`. Confirming.
6. **Plaintext memory hygiene.** Should `bulkEncryptMiddleware` zero the plaintext on the handle after writing the ciphertext, to limit window for accidental disclosure? Default: yes (set `handle.plaintext = undefined` after encryption); the user's original `EncryptedString.from(plaintext)` value is no longer reusable, which matches single-use semantics.

## Alternatives considered

### Per-cell codec without envelopes

The codec returns plaintext directly from `decode(wire)` and the middleware decrypts on every read. Users see `string`, no envelope class.

**Rejected** because it breaks bulk amortization on the read side: the codec is per-cell and the runtime races dispatches concurrently — there's no place to coalesce. Read-side bulk decryption requires either streaming-time coalescing (rejected as a non-goal), buffering inside the codec (the microtask-coalescer pattern, see next), or returning envelopes for explicit decryption (the chosen design).

### Microtask-coalescing batcher inside the codec body

The CipherStash team's first integration. The codec body owns a shared queue and a `Promise.resolve().then(...)` flush; per-cell calls enqueue, the microtask flushes once per JS turn with one bulk SDK call.

**Rejected** because the codec body ends up owning concurrency control, batch sizing, abort handling, and SDK error attribution — squeezed into the per-cell shape that doesn't fit any of them. Also opaque: future extensions implementing similar (Vault, AWS KMS, signing) each rediscover the same workaround. Moving the bulk dispatch to the middleware layer ([TML-2359](https://linear.app/prisma-company/issue/TML-2359)) and the read-side coalescing to a standalone utility (`decryptAll`) keeps each concern at the right layer.

### Result-set transformer instead of envelopes

A wrapper utility users apply to their result set: `for await (const row of decrypt(db.select(...).execute()))` — it runs bulk decryption and yields plaintext-typed rows.

**Rejected** because it doesn't fit streaming consumption (the transformer would have to buffer the whole result set before yielding the first row to enable bulk decryption), and because the user's row type would need to switch between "encrypted view" and "decrypted view" — pushing the type-shape concern into the consumer's awareness of which transformer they used. The envelope class keeps the type stable (`EncryptedString` always), and the user picks decrypt timing explicitly.

### A unified `KmsProvider` abstraction across CipherStash, Vault, AWS KMS

Define a generic `KmsProvider` interface; `@prisma-next/extension-kms` implements the envelope shape against an injected provider. CipherStash, Vault, etc. ship as `KmsProvider` adapters.

**Rejected for this phase.** Each SDK has different bulk-call shapes, different routing-key semantics, different error taxonomies, different cancellation contracts. A generic abstraction premature-optimizes a shape we've only validated against one SDK. The pattern (envelope class, codec, middleware, `decryptAll`) is the abstraction; the implementations stay per-SDK. If multiple KMS extensions converge on a clean common shape, factor a `@prisma-next/extension-kms-base` later.

### Lazy decryption on field access

Implement `EncryptedString` with a `Proxy` or getter that triggers decryption on first property access (`user.email + ''` triggers `decrypt()`).

**Rejected** because it makes decryption implicit — users can't tell when an `await` is happening, can't reason about when the SDK is being called, can't bulk-amortize. Explicit `await envelope.decrypt()` is the clearer mental model and matches the framework's "always-await codec methods" boundary established by [ADR 204](../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md).

### Public handle type

Export the handle's TypeScript shape so users can serialize / deserialize / inspect.

**Rejected** because the handle is implementation-detail of the SDK integration. Serializing an envelope to JSON is also rejected (handle private; `JSON.stringify(envelope)` should produce a placeholder or throw — pick least-surprising). Users who need cross-process envelope transport build their own serialization on top of `decrypt() → string → encrypt-on-other-side`.

## References

- [ADR 207 — Codec call context: per-query `AbortSignal` and column metadata](../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md). The codec-side context this extension's codec rides on.
- [ADR 204 — Single-Path Async Codec Runtime](../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md). The per-cell codec model this extension's codec composes with.
- [TML-2330 / PR #400](https://github.com/prisma/prisma-next/pull/400) — codec call context. Direct dependency; must merge first.
- [TML-2359](https://linear.app/prisma-company/issue/TML-2359) / `projects/middleware-param-transform/spec.md` — middleware seam this extension's bulk-encrypt rides on. Direct dependency for the middleware path; codec / envelope / `decryptAll` parts can land independently.
- [TML-2360](https://linear.app/prisma-company/issue/TML-2360) — this project's tracking ticket.
- CipherStash's `cipherstash/stack` repo, `prisma-next` branch — first-attempt integration showing the workarounds this project supersedes.
