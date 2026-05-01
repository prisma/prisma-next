# Summary

Ship `@prisma-next/extension-cipherstash`: a CipherStash/ZeroKMS-backed encrypted-column extension that uses the **envelope-codec pattern** to deliver column-aware encryption with bulk-amortized network I/O end-to-end.

The extension's user-facing shape is one envelope class (`EncryptedString`, `EncryptedJson`, etc.) per encrypted column type. The same envelope crosses both directions:

- **Write side**: users construct envelopes from plaintext (`EncryptedString.from('me@example.com')`); the extension's middleware (built on [TML-2359](https://linear.app/prisma-company/issue/TML-2359)) walks the plan's `ParamRef`s, batches all the envelope plaintexts into one `bulkEncrypt({ signal })` call, replaces values with ciphertexts. The codec's `encode` is identity by the time it runs.
- **Read side**: the codec's `decode` constructs an envelope wrapping the ciphertext and the column handle (table, column, KMS metadata) supplied by [TML-2330](https://linear.app/prisma-company/issue/TML-2330)'s `SqlCodecCallContext.column`. Users call `await row.email.decrypt()` per cell, or use bulk-decrypt convenience utilities (`decryptAll`, post-buffering of a result set) to amortize across many envelopes.

The handle is an internal data structure of the extension package, not a TypeScript surface visible to users.

# Description

CipherStash's ZeroKMS is a network-backed encryption service: every encrypt and decrypt is an HTTPS round-trip that's efficient only when amortized across many ciphertexts in one bulk call. The framework's per-cell `codec.encode` / `codec.decode` boundary doesn't naturally support bulk semantics — it dispatches per-cell, races concurrently via `Promise.all`, and offers no coalescing.

The CipherStash team's first attempt at integration (their `cipherstash/stack` repo, `prisma-next` branch) worked around this by stuffing a microtask-coalescing batcher inside the codec body. That works but is operationally awkward: the codec body owns concurrency control, batch sizing, abort handling, KMS-specific error attribution, and shadows the framework's per-cell shape. The [framework-gaps audit](../../docs/reference/framework-gaps.md) catalogues the friction this produced (G1 column-context plumbing, G4 unbounded-fan-out, G10 AbortSignal). Two of those three gaps are now closed:

- **G1 / G10 (column metadata + AbortSignal)** are resolved by [TML-2330](https://linear.app/prisma-company/issue/TML-2330) / [ADR 207](../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md).
- **G4 (bulk dispatch at the right layer)** is resolved by [TML-2359](https://linear.app/prisma-company/issue/TML-2359) — the middleware param-transform seam, which lets a plan-walker batch the work and have `codec.encode` run as identity.

This project is the **first real consumer** of both seams. It exercises the contracts end-to-end against a real SDK (CipherStash's `@cipherstash/protect` SDK or whatever the team currently ships) and produces a reusable extension package that downstream Prisma Next users can install.

The pattern this project records — **envelope class on both sides, middleware does the work** — is the recommended pattern for any future extension whose codec is network-backed and bulk-friendly: signing/verifying audit columns, KMS-encryption, schema-bound JSON validation against external schema services, etc. CipherStash is the reference implementation.

# Description of the user-facing shape

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
import { EncryptedString } from '@prisma-next/extension-cipherstash';

// Write — user constructs an envelope from plaintext.
await db.insert(User, {
  email: EncryptedString.from('alice@example.com'),
}).execute({ signal });

// Read — codec returns an envelope; user decrypts on demand.
for await (const user of db.select(User).execute({ signal })) {
  console.log(await user.email.decrypt()); // single-cell decrypt
}

// Read with bulk decryption — collect a window, then bulk-decrypt.
import { decryptAll } from '@prisma-next/extension-cipherstash';

const users = await collectAll(db.select(User).execute({ signal }));
await decryptAll(users, { signal });   // walks all values, finds envelopes,
                                        // groups by handle, one bulk call per group,
                                        // mutates in place.
console.log(users[0]!.email);          // string (already decrypted in place)
```

The envelope class is the load-bearing shape. Both `encode`-time and `decode`-time codec arms operate on the same `EncryptedString` type — the value crossing into `ParamRef` carries plaintext + handle (write side), the value coming out of `decode` carries ciphertext + handle (read side). The middleware (write side) and the bulk-decrypt utilities (read side) walk these envelopes wherever they appear, group by handle, and amortize the network call.

# Description of the envelope shape

```ts
// Public surface — the type users see.
export class EncryptedString {
  /** Construct from plaintext. The extension's middleware will encrypt this on its way out. */
  static from(plaintext: string): EncryptedString;

  /** Decrypt this envelope (single-cell). Returns the original plaintext. */
  decrypt(opts?: { signal?: AbortSignal }): Promise<string>;
}
```

The `EncryptedString` class **owns its handle internally** — closure / private field / WeakMap, the choice is an implementation detail. The handle bundles whatever CipherStash needs:
- The plaintext (write side, before middleware encryption).
- The ciphertext (read side, after the SDK returns).
- The column identity (`{ table, column }`) supplied by `SqlCodecCallContext.column` at decode time.
- Any SDK-specific routing keys (dataset, key ID, etc.) that the SDK requires for `bulkEncrypt` / `bulkDecrypt` to address the right material.

The handle has **no TypeScript surface** outside the extension package. Users see `EncryptedString` with `from` and `decrypt`. The middleware and bulk-decrypt utilities, also inside the extension package, reach into the handle via package-internal helpers.

The same approach scales to other types: `EncryptedJson`, `EncryptedNumber`, etc., one envelope class per encrypted column type. They share a common base implementation (handle storage, single-cell decrypt) and differ only in their plaintext type.

# Requirements

## Functional Requirements

1. **Package layout**: `@prisma-next/extension-cipherstash` is a published npm package under `packages/3-extensions/cipherstash/`, taking peer dependencies on `@prisma-next/sql-relational-core`, `@prisma-next/framework-components`, and the CipherStash SDK (whichever package the team currently ships).

2. **Subpath exports** mirroring the existing extension shape (e.g. `extension-pgvector`):
   - `@prisma-next/extension-cipherstash` — runtime entry (envelope classes, `decryptAll` utility, factory)
   - `@prisma-next/extension-cipherstash/column-types` — authoring-time column constructors (`encryptedString`, etc.)
   - `@prisma-next/extension-cipherstash/codec-types` — codec ID constants and Codec exports
   - `@prisma-next/extension-cipherstash/middleware` — the bulk-encrypt middleware factory

3. **Envelope classes** owning their handle internally:
   - `EncryptedString.from(plaintext: string): EncryptedString`
   - `EncryptedString.decrypt(opts?: { signal? }): Promise<string>`
   - At minimum, ship `EncryptedString` and `EncryptedJson` (the two most common). Other types can land additively.

4. **Codecs** registered with target type `vector` / `text` / etc. as appropriate per column type:
   - `cipherstash/string@1`, `cipherstash/json@1`, etc.
   - `encode: (envelope, ctx) => ciphertext` — by the time encode runs, the middleware has already replaced the plaintext with ciphertext via [TML-2359](https://linear.app/prisma-company/issue/TML-2359), so `encode` is effectively identity (extracts `envelope.handle.ciphertext`).
   - `decode: (ciphertext, ctx) => new EncryptedString({ ciphertext, handle: { table: ctx.column.table, column: ctx.column.name } })` — the codec wraps the wire value into a fresh envelope carrying the column handle.
   - `renderOutputType: () => 'EncryptedString'` (etc.) so emit produces user-visible types.

5. **Bulk-encrypt middleware** (the consumer of [TML-2359](https://linear.app/prisma-company/issue/TML-2359)):
   - Walks `params.entries()` filtering for ParamRefs whose `codecId` is in the CipherStash codec ID set.
   - Extracts the plaintext from each envelope's handle.
   - Issues one `cipherstashSdk.bulkEncrypt({ values, signal: ctx.signal })` call.
   - Calls `params.replaceValues(...)` to write the resulting ciphertexts back into the plan's ParamRefs (or directly into the envelope handles, depending on which is cleaner — the codec's `encode` then extracts `handle.ciphertext`).

6. **Single-cell decrypt** on each envelope (`envelope.decrypt({ signal? })`) calls the SDK with one ciphertext. Cheap and obvious; doesn't try to coalesce. Users who want amortization use `decryptAll`.

7. **Bulk-decrypt utility** as a standalone export from `@prisma-next/extension-cipherstash`:
   - `decryptAll(rows: unknown, opts?: { signal? }): Promise<void>` — walks `rows` recursively (objects, arrays, nested), finds every value that is an `EncryptedString` (or any extension envelope), groups by handle (which carries the SDK routing key), issues one `bulkDecrypt({ ciphertexts, signal })` per group, mutates each envelope in place to cache the plaintext.
   - After `decryptAll`, calling `envelope.decrypt()` on a previously-bulk-decrypted envelope returns the cached plaintext synchronously (no SDK call).
   - Users who want selective decryption (e.g. "only `email` fields") write their own walker over their result set; `decryptAll` is the catch-all convenience.

8. **The handle is internal**: no public TypeScript export of the handle shape. The handle's structure is whatever CipherStash needs internally; framework + downstream code never references it.

9. **No driver-level cancellation**: `decryptAll` and `envelope.decrypt` honour `opts.signal` (or `ctx.signal` in the codec arm) by forwarding to the SDK. The SDK's network round-trip is what gets cancelled. The framework runtime is on a separate cancellation path (per [ADR 207](../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md)) and is unaffected.

## Non-Functional Requirements

10. **TypeScript shape end-to-end**: `User.email` resolves to `EncryptedString` in user code, both at the no-emit path (TS plays the contract) and at the emit-path (`pnpm emit` writes `EncryptedString` into `contract.d.ts`). The user never sees `string` for an encrypted column unless they explicitly call `await user.email.decrypt()` or call `decryptAll`.

11. **Bulk amortization**: A query inserting N rows × M encrypted columns issues exactly **one** `bulkEncrypt` call (per ZeroKMS dataset / key, if the SDK requires partitioning). Same for read-side `decryptAll`. This is the property the project exists to deliver; verified by integration tests against a stub or real SDK.

12. **Cooperative cancellation**: forwarding `ctx.signal` / `opts.signal` to the SDK aborts in-flight HTTPS calls. In-flight SDK bodies that ignore the signal complete in the background (per the existing framework contract).

13. **Documentation**:
    - Package README explaining the envelope pattern, when to use `decrypt()` vs `decryptAll`.
    - One worked example end-to-end in `examples/` or in the README.
    - A "for-extension-authors" guide on how to write a CipherStash-shaped extension (link from `docs/`-side after project close-out — see Close-out section).

## Non-goals

- **No streaming-time decryption.** Decryption is always explicit — users either call `envelope.decrypt()` per cell, or buffer the result set first and call `decryptAll`. The framework's streaming path doesn't try to decrypt envelopes mid-iteration.

- **No selective-by-column `decryptAll`**. The first-pass utility decrypts every envelope it finds. Users who want "only decrypt `email`, leave `phone` alone" write their own walker. Selective convenience is a phase-2 add-on if there's demand.

- **No KMS provider abstraction**. This package is CipherStash-specific. A future `@prisma-next/extension-vault`, `@prisma-next/extension-aws-kms` would follow the same envelope-codec pattern but ship as separate packages with their own envelope classes. We don't try to factor a shared KMS interface this round.

- **No re-implementation of the CipherStash SDK**. The extension wraps the existing CipherStash SDK; if the SDK lacks `bulkEncrypt` or `bulkDecrypt` shape that fits the middleware contract cleanly, that's an SDK-side change to coordinate with the CipherStash team, not framework work.

- **No migration support for existing schemas**. Adopting CipherStash for an existing column requires a data migration (re-encrypt existing rows). That's out of scope; users do it via Prisma Next's migration tooling and a one-off script. The framework can later grow a "rotate codec" migration primitive but not in this project.

# Acceptance Criteria

## Package shape

- [ ] **AC-PKG1**: `@prisma-next/extension-cipherstash` published from `packages/3-extensions/cipherstash/` with subpath exports listed above.
- [ ] **AC-PKG2**: `pnpm lint:deps` passes; the extension imports only from public framework / SQL family / family-extension surfaces.
- [ ] **AC-PKG3**: Peer-deps declared correctly; `node_modules` resolution works against a fresh consumer install.

## Envelope classes

- [ ] **AC-ENV1**: `EncryptedString.from(plaintext)` returns an envelope carrying the plaintext + (write-side) empty handle.
- [ ] **AC-ENV2**: `envelope.decrypt({ signal? })` returns the original plaintext via the SDK's single-cell decrypt; `signal` is forwarded to the SDK call.
- [ ] **AC-ENV3**: After `decryptAll`, `envelope.decrypt()` returns the cached plaintext synchronously without touching the SDK.
- [ ] **AC-ENV4**: The handle has no public TypeScript surface — users cannot import the handle type, and the envelope's public methods don't expose it.
- [ ] **AC-ENV5**: At least two envelope types ship (`EncryptedString`, `EncryptedJson`).

## Codec

- [ ] **AC-CODEC1**: `cipherstash/string@1` codec registered with target type `text`, traits as appropriate.
- [ ] **AC-CODEC2**: `decode(ciphertext, ctx)` constructs an envelope carrying `ctx.column = { table, name }` in the handle. Asserted with a unit test that uses [TML-2330](https://linear.app/prisma-company/issue/TML-2330)'s plumbing.
- [ ] **AC-CODEC3**: `encode(envelope, ctx)` extracts the (already-encrypted) ciphertext from the envelope's handle and returns it. Verified against a fixture where the middleware has run and replaced plaintext with ciphertext.
- [ ] **AC-CODEC4**: `renderOutputType` produces `EncryptedString` (etc.) so emit-path output reflects the envelope type.

## Bulk-encrypt middleware

- [ ] **AC-MW1**: The middleware factory produces a `SqlMiddleware` whose `beforeExecute` walks `params.entries()` filtered by codec ID set.
- [ ] **AC-MW2**: For a plan inserting N rows × M cipherstash columns, exactly **one** `cipherstashSdk.bulkEncrypt` call is issued (verified with a mock SDK in tests).
- [ ] **AC-MW3**: The middleware forwards `ctx.signal` to the SDK; an aborted signal at `beforeExecute` entry surfaces `RUNTIME.ABORTED { phase: 'beforeExecute' }`.
- [ ] **AC-MW4**: After the middleware runs, the codec's `encode` receives ciphertext (verified by recorder codec).

## Bulk-decrypt utility

- [ ] **AC-DEC1**: `decryptAll(rows, { signal? })` walks the result set, finds every envelope (regardless of nesting depth), and decrypts in place. Verified for nested objects, arrays, and the top-level row case.
- [ ] **AC-DEC2**: For a result set with K envelopes across distinct routing keys, exactly **one** `bulkDecrypt` per group is issued.
- [ ] **AC-DEC3**: After `decryptAll`, every envelope's `decrypt()` returns the cached plaintext synchronously.
- [ ] **AC-DEC4**: An aborted signal mid-`decryptAll` causes the function to throw `RUNTIME.ABORTED { phase: 'decode' }` (or equivalent — the exact phase tag is open for discussion).

## End-to-end integration

- [ ] **AC-E2E1**: An end-to-end test inserts and reads encrypted rows through the framework against a stub queryable + mock SDK. The full round-trip preserves plaintext through write / read / decrypt.
- [ ] **AC-E2E2**: Same test verifies bulk amortization (one network call per direction).
- [ ] **AC-E2E3**: At least one example app under `examples/` demonstrates the pattern with realistic shapes.

## Documentation

- [ ] **AC-DOC1**: Package `README.md` documents the envelope-codec pattern, the `decrypt()` vs `decryptAll` choice, and at-a-glance setup steps.
- [ ] **AC-DOC2**: A worked example exists in `examples/` showing the full read-write loop.
- [ ] **AC-DOC3**: An ADR (or extension to ADR 207's "Alternatives considered" / "Worked example") records the envelope-codec pattern as the canonical recommended approach for any network-backed bulk-amortizable codec.

# Other Considerations

## Security

- The handle stays inside the extension package. Users cannot accidentally serialise an envelope to JSON and lose the plaintext / ciphertext distinction (handle fields are private; `JSON.stringify(envelope)` yields a placeholder or throws — pick one based on what's least surprising).
- `EncryptedString.from(plaintext)` keeps the plaintext alive as long as the envelope object — there's no automatic zeroing of plaintext memory. Users with strict secrets-hygiene requirements need to dispose envelopes promptly. Document this expectation.
- The bulk-encrypt middleware's batch may end up in driver-side query logging (the SDK has already encrypted the values, so the *ciphertext* is what gets logged — not plaintext). This is fine, but worth calling out.

## Cost

- Bulk amortization is the value prop: adopting this extension instead of per-cell codecs reduces ZeroKMS request count from O(N×M) to O(K) per query (K = distinct routing keys). For typical applications K = 1.
- Local CPU cost of envelope construction is negligible.

## Observability

- The extension should emit telemetry events for `bulk.encrypt.batchSize`, `bulk.decrypt.batchSize`, `bulk.encrypt.durationMs`, `bulk.decrypt.durationMs` so consumers can observe the amortization is working as expected. These flow through whatever telemetry seam the framework already exposes.

## Data Protection

- This extension is the data-protection mechanism for any column adopting it; it doesn't itself process additional personal data. The framework's existing observability (telemetry events, error envelopes) doesn't carry decrypted plaintext into logs (the codec body is the only place plaintext is materialized, and only after explicit `decrypt()` calls). Reviewers verify this property.

## Analytics

- Out of scope for this extension. Downstream consumers' analytics are their concern.

# References

- [TML-2330 / PR #400](https://github.com/prisma/prisma-next/pull/400) — codec call context, per-query `AbortSignal`, decode-side column metadata. Direct dependency.
- [TML-2359](https://linear.app/prisma-company/issue/TML-2359) / `projects/middleware-param-transform/spec.md` — the bulk-encrypt middleware seam this extension consumes. Direct dependency.
- [ADR 207](../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md) — the codec-side shape this extension's codec rides on.
- [framework-gaps audit](../../docs/reference/framework-gaps.md) — the original CipherStash team friction inventory. Three of three gaps (G1, G4, G10) closed by this project + its dependencies.
- CipherStash's `cipherstash/stack` repo, `prisma-next` branch — first-attempt integration showing the workarounds this project supersedes.
- [ADR 204](../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md) — the per-cell codec model this extension's codec composes with.

# Open Questions

1. **Which CipherStash SDK to depend on?** The team has multiple SDKs; pick the one with the cleanest `bulkEncrypt` / `bulkDecrypt` shape. If the existing SDK doesn't have those operations as exports, coordinate with the CipherStash team to add them. Worst case, the extension wraps a multi-call internally.

2. **Routing-key semantics in the handle.** Different SDK versions may key bulk calls by `(dataset, keyId)` or by `(dataset)` alone. The handle's grouping shape needs to match what the SDK requires. Settle this by reading the current SDK's `bulkEncrypt` / `bulkDecrypt` signatures before coding the bulk-decrypt utility.

3. **Phase tag for `decryptAll` aborts**: when `decryptAll` itself observes `ctx.signal.aborted` and throws, what phase tag goes on the `RUNTIME.ABORTED` envelope? `decode` is closest, but `decryptAll` runs *outside* a `runtime.execute()` call — it's a standalone post-buffering utility. Possibly invent `'decrypt-all'` or just use `'decode'` (the user's mental model is "this is a decode-side operation"). Default: `'decode'`.

4. **`encryptedString` column-type's `targetTypes`**: the underlying storage is `text` (or `bytea`?) in Postgres. The extension picks one canonical storage; users adopting this extension migrate to that storage. Pick `text` (ciphertexts are typically base64-encoded by the SDK, so they're text-shaped on the wire) and document it.

5. **Should `EncryptedJson` ride on top of an in-tree JSON codec or be a fresh codec?** The latter — `cipherstash/json@1` is its own codec ID, with `targetTypes: ['jsonb']` (or `'text'` if ciphertexts are stored as opaque text). It doesn't compose with `pg/json@1` etc. Confirming.

# Project relationship

This project depends on:
- **TML-2330 / PR #400** (this is the PR that's currently in review): provides the `SqlCodecCallContext.column` and per-query `AbortSignal` plumbing the codec uses at decode time. **Must merge first.**
- **`projects/middleware-param-transform/spec.md` / TML-2359**: provides the `ParamRefMutator` API the bulk-encrypt middleware uses. **Must merge before this project's middleware lands**, but the codec / envelope / bulk-decrypt parts can land independently.

The two predecessor projects are **necessary infrastructure**; this project is the **first real consumer** that exercises both contracts end-to-end. If a contract change to either predecessor surfaces during implementation here, that's a signal to iterate the predecessor — not to work around it.

# Close-out (project-specific)

In addition to the standard close-out (verify ACs, migrate long-lived docs into `docs/`, strip references, delete the project dir), this project's close-out should specifically:

- **Migrate the envelope-codec pattern** documentation into a durable doc — likely a section in `docs/architecture docs/extension-patterns/` or an extension to ADR 207's worked-example section. Future extension authors writing network-backed bulk-amortizable codecs (Vault, AWS KMS, signed columns, etc.) should find this pattern as a canonical reference, not a transient project note.
- **Update `framework-gaps.md`**: G1, G4, G10 should all be marked Resolved by the time this project closes, with pointers to ADR 207 + the new pattern doc + this extension as the reference implementation.
