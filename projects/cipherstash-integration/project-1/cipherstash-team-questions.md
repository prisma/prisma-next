# Questions for the CipherStash team — Project 1 (searchable-encryption MVP)

> **Purpose.** This doc captures two design defaults we're shipping in `@prisma-next/extension-cipherstash` that we'd like the CipherStash team to validate. Neither blocks delivery — we've made a call and the code is on track to land — but both touch user-visible behavior, so we'd rather know post-delivery whether you'd like us to change the default before any external user adopts the extension.
>
> **Framing for the conversation.** We're not asking you to gate Project 1 on these answers. We picked the defaults that match the reference integration in your `cipherstash/stack` repo (where applicable) and that are simplest to ship. If you'd push back on either, the implication for our extension is small and bounded — we describe exactly what changes for each "no" answer below. After Project 1 ships, the cipherstash extension is something your team can iterate on directly; these defaults are us trying not to back you into a corner.

## Background — what we're building, briefly

`@prisma-next/extension-cipherstash` adds a `EncryptedString` column type to Prisma Next, backed by ZeroKMS for encryption and EQL for searchable queries. The user-facing surface looks like this:

```ts
// Schema (PSL or TS)
model User {
  id    String          @id
  email EncryptedString({ equality: true, freeTextSearch: true })
}

// Query
await db.insert(User, { id: '1', email: EncryptedString.from('alice@example.com') });
const rows = await db.findMany(User, { where: { email: { equals: 'alice@example.com' } } });
await decryptAll(rows);
console.log(rows[0].email.decrypt()); // 'alice@example.com'
```

Internally:

- `EncryptedString.from(plaintext)` produces an envelope object whose internal handle holds the plaintext until middleware encrypts it.
- A bulk-encrypt middleware runs in `beforeExecute` and rewrites every cipherstash envelope's plaintext into ciphertext via `sdk.bulkEncrypt(...)` calls — one call per "routing key" group (defined below).
- The codec emits the ciphertext to the wire as `eql_v2_encrypted` JSONB; reads decode it back into envelopes.
- `await envelope.decrypt()` decrypts a single cell on demand. `await decryptAll(rows)` walks a result set and bulk-decrypts everything in one round-trip per routing key.

The two questions below are both about the bulk-encrypt middleware path on the write side.

## Question 1 — Routing-key derivation

### What we're asking

When the bulk-encrypt middleware sees, say, 50 envelopes in one query — some heading to `users.email`, some to `users.phone`, some to `accounts.recovery_email` — how should it group them into `sdk.bulkEncrypt(...)` calls?

We're going with: **group by `(table, column)`. One bulk call per `(table, column)` group. No user-facing override.** That means a query inserting 30 emails + 20 phones makes two `bulkEncrypt` calls, not one.

We want to know whether that grouping matches what ZeroKMS expects, and whether we're missing a use case where the routing key needs to carry more information than `(table, column)`.

### Why this is even a decision

Your bulk-encrypt API has two surfaces in the reference repo:

- `**bulkEncrypt(plaintexts, { column, table })`** — homogeneous, one `(table, column)` per call. (`reference/cipherstash/stack/packages/protect/src/ffi/index.ts:386`)
- `**bulkEncryptModels(models, table)**` + the underlying `**encryptBulk(client, { plaintexts: heterogeneousArray })**` — heterogeneous, where each entry in the array can carry its own `{ table, column }`. (`reference/cipherstash/stack/packages/protect/src/ffi/model-helpers.ts:665`)

The heterogeneous shape would let the middleware do *one* SDK call per query regardless of how many distinct columns are involved. The homogeneous shape requires us to chunk by `(table, column)` and make N calls. The heterogeneous version is fewer round-trips; the homogeneous version is simpler and more obvious about cost.

We picked the homogeneous shape — partly because it's the "primary" surface in your public API documentation, partly because we want users to be able to read the middleware code and immediately understand "one round-trip per `(table, column)`", and partly because it locks the SDK boundary at a smaller, simpler interface. Our `CipherstashSdk.bulkEncrypt` signature is:

```ts
bulkEncrypt(args: {
  routingKey: { table: string; column: string };
  values: ReadonlyArray<string>;
  signal?: AbortSignal;
}): Promise<ReadonlyArray<unknown>>;
```

So at the seam between our middleware and your SDK, the contract is one homogeneous batch per call.

### What this means for users

In the `encryptedString({...})` factory (the user-facing column-type declaration), we **do not** expose any field that affects routing — no `keyId`, no `dataset`, no per-column override. The column's "routing key" is purely derived from where it lives in the contract (i.e. its `(table, column)` pair). If a user wants a column to encrypt under a different ZeroKMS dataset/key, today they don't have a knob for it; they'd configure it via your SDK setup outside our extension.

### Specific things we'd love to hear from you

1. **Is `(table, column)` the right primary routing dimension?** Our reading is that it is — `EncryptOptions = { column, table }` in your types — but we want to confirm there isn't a customer pattern where the dataset/key-id varies per *something else* (per-tenant, per-environment, per-row category) such that "always derive from `(table, column)`" would be wrong by default.
2. **Should the user be able to override routing on a per-column basis from the schema?** For example, do you have customers who'd want to write `email: encryptedString({ equality: true, datasetId: 'pii-keys' })` to make `users.email` encrypt under a different key than `users.legal_name`? Today our default is "no, this isn't a thing in Project 1" — if you say "yes, customers ask for this", we'd add an optional `datasetId?: string` field on `encryptedString({...})` and thread it through the routing key. That's a small, additive change.
3. **How do your customers handle multi-tenant deployments today?** Specifically: one Node process serving many tenants, with each tenant getting different ZeroKMS keys. Our implicit assumption is that this is solved by constructing one `db` runtime per tenant, each with its own SDK instance — i.e. tenancy lives one level above our extension. If customers expect tenancy to be expressible *inside* a single runtime via per-call routing, we'd need a different shape.
4. **Are we losing anything material by going homogeneous-per-`(table, column)` instead of heterogeneous-per-query?** A query inserting envelopes for 5 different columns will make 5 `bulkEncrypt` calls in our shape vs. 1 in the heterogeneous shape. We accept that as a clarity-vs-throughput trade-off. If 5 round-trips is a problem at the latencies you typically see, we'd want to know — that's the kind of feedback that'd push us toward the heterogeneous shape.

### What changes for each answer

- **"Yes, `(table, column)` is right; no per-column override needed."** Zero changes; we ship as designed.
- **"Yes, but customers want a per-column dataset/key-id override."** We add `datasetId?: string` (or whatever you prefer to call it) to `encryptedString({...})`, thread it through the envelope handle's routing-key tuple, and expose it on the `bulkEncrypt` args. Bounded refactor, additive, doesn't break existing callers.
- **"You should be using the heterogeneous shape — `(table, column)`-chunking is too many round-trips."** Larger refactor: the `CipherstashSdk` interface widens to take a heterogeneous payload, the middleware drops the per-`(table, column)` grouping, and we coordinate one call per query. Still bounded — a couple of files in our extension.
- **"Tenancy needs to be expressible per-call, not per-runtime."** Larger conversation. Likely a per-execute "context" hook on our runtime that the middleware reads to pick a routing key. We'd want to talk through what shape works for you.

## Question 2 — Plaintext zeroing post-encrypt

### What we're asking

When the bulk-encrypt middleware finishes encrypting an envelope's plaintext, the envelope's internal handle now holds *both* the original plaintext (still in the `plaintext` slot, because that's how it got there from `EncryptedString.from(...)`) and the freshly-computed ciphertext. The question is whether we should overwrite the plaintext slot with `undefined` post-encryption, so the GC can reclaim the original plaintext string sooner.

We're going with: **no, don't zero. Leave the plaintext on the handle. The user keeps both the plaintext and the ciphertext until they release their reference to the envelope.**

We want to know whether that posture matches what your team would recommend, or whether you'd want us to zero by default to align with the rest of the cipherstash ecosystem's hygiene expectations.

### Why this is a decision worth making explicitly

Plaintext on the heap after encryption is a security-hygiene concern. If a Node process's heap is dumped (debugger, crash dump, leaked log line, attached observability tool), recently-encrypted plaintext shouldn't sit around waiting for GC any longer than necessary. The textbook posture is "drop the reference as soon as you're done with it".

But: in JavaScript, "zeroing" a plaintext string means setting the slot holding the string reference to `undefined`. The original `string` value is immutable — there's no way to actually overwrite the bytes from JS. So the security win is real but bounded: we'd narrow the window between encryption and GC, but we wouldn't eliminate the plaintext from memory deterministically.

Two things made us pick "don't zero" as the default:

1. **Mostly-symbolic security gain.** The win is "one fewer reference" until GC runs. Strict-hygiene users who need real zeroization can't get it from a JS string anyway; they'd need a `Buffer.fill(0)` discipline or out-of-process KMS — neither of which is solved by us zeroing the handle slot.
2. **Useful side effect we get by not zeroing: synchronous read-back.** A user who writes `const env = EncryptedString.from('x'); await db.insert(...); console.log(await env.decrypt())` gets the original plaintext back synchronously, without an SDK round-trip, because the handle still holds the plaintext. With zeroing on, `env.decrypt()` post-write would either error (no plaintext, no SDK binding on a write-side envelope) or quietly hit the SDK. Either is a footgun.

### What this means for users

- A user who wants the plaintext back after a write gets it for free, no SDK call.
- A user with strict secrets-hygiene requirements drops envelope references promptly themselves; once nothing holds the envelope, the GC reclaims the plaintext along with everything else on the handle.
- We don't expose an `envelope.dispose()` API in Project 1. If real customers ask for explicit zeroization, that's a phase-2 add-on.

### Specific things we'd love to hear from you

1. **What's your team's recommended default?** Specifically: in the existing Drizzle integration and your Prisma plugin, do you actively drop plaintext references post-encrypt, or do you leave them for GC like we're proposing?
2. **Have customers asked for explicit zeroization?** A `dispose()` method, a `using envelope = ...` Symbol.dispose pattern, anything like that? We'd rather match existing customer expectations than invent one.
3. **Is there a documented threat-model statement we can point users at?** We'd like our extension's docs to be consistent with whatever you say to customers about plaintext residency. If you have a doc page or an RFC, we'll link to it; if you don't, we'll write something neutral and run it past you.
4. **Does your SDK do anything notable with plaintext memory during/after encryption?** E.g. does the SDK take ownership of plaintext buffers and zero its own copies? If so, our "we keep a copy on the handle" default looks worse next to your hygiene; if not, our default is consistent with the rest of the chain.

### What changes for each answer

- **"Your default is fine; we don't have customers who'd push back."** Zero changes; we ship as designed.
- **"Default should be to zero post-encrypt, the way Drizzle does it."** One-line code change: re-add `handle.plaintext = undefined` to our `setHandleCiphertext` helper. Flip the relevant acceptance criterion. We'd update docs to call out the side effect ("`decrypt()` after a write makes an SDK call") explicitly.
- **"You should expose a `dispose()` API too."** Small additive change — implement `envelope[Symbol.dispose]()` (or `dispose()`, depending on what you'd prefer) that nukes the entire handle. Doesn't change the default behavior, just gives strict-hygiene users a knob.
- **"Both: zero by default *and* expose dispose."** Combine the above two.

## Adjacent topics we'd appreciate input on (lower-priority)

These aren't blocking design decisions — we have working answers — but if any of them snag in conversation, we'd rather hear about it now than after we ship.

### EQL bundle vendoring

We're currently planning to vendor the EQL install SQL bundle from your reference repo (`reference/cipherstash/stack/packages/stack/src/prisma/core/eql-bundle.ts`) into our extension package. Two things we want to confirm:

- **Is there a maintained source for the EQL bundle that we should pull from instead?** A versioned npm package, a release artifact, an upstream repo we can pin to a tag? Our preference is "fetch from a versioned source" over "vendor a snapshot", but only if the source exists and is stable.
- **What's your release cadence for EQL?** When you ship a new EQL version, what's the path for our users to upgrade? Today the only path we have planned is "we bump the vendored bundle in a new extension release"; if that's wrong, we'd want to align.

### Live-EQL integration testing

Project 1's M2.c milestone needs a Postgres database with EQL installed, reachable from our test runner. We have a working pattern for live-Postgres tests (`pnpm test:integration` spins up containers); we plan to extend it to install the EQL bundle on container boot via our `databaseDependencies.init` machinery. Two questions:

- **Is there a recommended Postgres + EQL test image / docker-compose setup you use internally?** If yes, we'd rather mirror it than reinvent. If no, we'll publish what we end up with.
- **Are there gotchas in EQL install we should know about?** Required Postgres extensions, role/privilege requirements beyond superuser, ordering constraints with other extensions, anything that's bitten you. The reference `eql-bundle.ts` looks self-contained but we'd appreciate "watch out for X" notes if you have them.

### Operator-lowering shape (M3, not M2.c)

Our M3 milestone implements the `eq` and `ilike` operators against cipherstash columns, which means we lower `where: { email: { equals: 'x' } }` into something like `eql_v2.eq("email", eql_v2.encrypt($1, ...))`. We're planning to defer to your `reference/cipherstash/.../operation-templates.ts` file as the source of truth for the exact SQL function calls. Question for when we get to M3:

- **Is `operation-templates.ts` still the canonical reference?** If you've moved to a different shape since the first-attempt repo, point us at it.
- **Does the EQL operator surface have any quirks we should plan around?** E.g. operand ordering, null handling, casting requirements. We've sketched out null short-circuiting (`email IS NULL` lowers to plain SQL, not EQL) but there may be others.

This isn't blocking right now; raising it now in case the conversation naturally goes there.

## Summary — what we need from you today

If we only get a few minutes:

1. **Routing key**: "Does deriving the routing key from `(table, column)`, with no per-column user override, match how you expect customers to use ZeroKMS in Postgres?"
2. **Plaintext zeroing**: "Should our default be to drop the plaintext reference post-encrypt, or to leave it on the envelope?"

If we get longer, the EQL bundle and integration-testing topics are the most useful to walk through, since they affect M2.c delivery directly. Operator lowering can wait until M3.

Thanks for the time. Project 1 is on track and we expect to deliver an end-to-end demoable searchable-encryption MVP shortly; this conversation is about making sure the defaults we ship don't paint your team into a corner when you take ownership of the extension.