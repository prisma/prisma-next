# `@prisma-next/extension-cipherstash` — design

> **Audience.** The CipherStash engineering team. This document describes the design of `@prisma-next/extension-cipherstash` — the first-party Prisma Next extension for searchable encryption, backed by ZeroKMS for encryption and EQL for query lowering. It covers what we are building, how it integrates with your products, and the design decisions where we'd value your input.
>
> **Status.** Project 1 of the cipherstash-integration umbrella, now rebased onto **contract spaces** ([TML-2397](https://linear.app/prisma-company/issue/TML-2397)). Contract spaces is a framework-level mechanism that lets extensions contribute schema objects to the user's database as first-class participants — same planner, same runner, same migration shape as application authoring. TML-2397 already shipped the cipherstash control plane (descriptor, codec lifecycle hook, contract-space artefacts, EQL bundle install). Project 1 now delivers only the runtime layer on top: envelope, SDK interface, codec encode/decode, bulk-encrypt middleware, PSL constructor, TS factory, operator lowering, end-to-end tests. This document describes the **end-state** — what the extension looks like with Project 1 complete.
>
> **Related material.** Two specific design defaults we'd like you to validate are framed in detail in `[cipherstash-team-questions.md](cipherstash-team-questions.md)` — routing-key derivation and plaintext-zeroing post-encrypt. Both are summarized in § Open design questions below; the questions doc is the deep-dive companion.

---

## What the extension is

`@prisma-next/extension-cipherstash` is a workspace package shipped alongside Prisma Next. It plugs into Prisma Next's extension protocol the same way `@prisma-next/extension-pgvector` does, exposing:

- A new column type (`EncryptedString`) that users author in PSL or TypeScript.
- A new Postgres native type (`eql_v2_encrypted`) — a `JSONB` domain mirroring the type EQL already installs.
- A codec (`cipherstash/string@1`) that handles wire encoding/decoding of encrypted values.
- A bulk-encrypt middleware that coalesces ZeroKMS calls on the write side.
- A `decryptAll(rows)` utility that coalesces ZeroKMS calls on the read side.
- A **contract space** that declares the EQL schema (`eql_v2_configuration` and friends), installs the EQL bundle as the body of one baseline migration op, and emits per-column `add_search_config` / `remove_search_config` ops automatically as the user adds, drops, or alters `Encrypted<string>` columns. Users do not write `addSearchConfig(...)` calls in migration files — the codec lifecycle hook on the extension does that for them.

The extension exposes searchable-encryption as a first-class column type, while keeping all CipherStash-specific behavior (encryption, decryption, EQL operator lowering, search-config registration) opt-in to that single column type. Non-encrypted columns and queries are unaffected.

---

## End-user experience

### Authoring a column (PSL)

```prisma
model User {
  id    String                          @id
  email cs.EncryptedString({ equality: true, freeTextSearch: true })
  name  String
}
```

Or with a named type alias:

```prisma
types {
  Email = cs.EncryptedString({ equality: true, freeTextSearch: true })
}

model User {
  id    String  @id
  email Email
  name  String
}
```

### Authoring a column (TypeScript)

```ts
import { defineSchema, table, string, primaryKey } from '@prisma-next/sql-authoring';
import { encryptedString } from '@prisma-next/extension-cipherstash/column-types';

export const schema = defineSchema((c) =>
  c.table('User', {
    id:    primaryKey(string()),
    email: encryptedString({ equality: true, freeTextSearch: true }),
    name:  string(),
  }),
);
```

The two paths produce **byte-identical** `contract.json`. Users pick whichever surface fits their workflow; the runtime treats both contracts as equivalent.

### Inserting

```ts
import { EncryptedString } from '@prisma-next/extension-cipherstash';

await db.insert(User, {
  id:    '1',
  email: EncryptedString.from('alice@example.com'),
  name:  'Alice',
});
```

`EncryptedString.from(plaintext)` produces a lightweight envelope object. Internally it carries the plaintext until the bulk-encrypt middleware runs in `beforeExecute`; at that point the middleware calls `sdk.bulkEncrypt(...)` once per `(table, column)` group, then stamps each envelope with its ciphertext. The codec encodes envelopes to wire as `eql_v2_encrypted` JSONB.

### Querying

```ts
const rows = await db.findMany(User, {
  where: { email: { equals: 'alice@example.com' } },
});

const matches = await db.findMany(User, {
  where: { email: { contains: 'alice' } },
});
```

`equals` lowers to `eql_v2.eq("email", eql_v2.encrypt($1, ...))`; `contains` lowers to `eql_v2.ilike(...)`. The plaintext on the right-hand side is parameterized — never interpolated — and goes through ZeroKMS via `bulkEncrypt` for the WHERE-clause predicate just as if it were an inserted value. `where: { email: null }` short-circuits to plain `email IS NULL` and never reaches EQL.

### Decryption

```ts
const env = rows[0].email;             // an EncryptedString envelope
const plaintext = await env.decrypt(); // single-cell decrypt via sdk.decrypt(...)
```

Or, for batches:

```ts
import { decryptAll } from '@prisma-next/extension-cipherstash';

await decryptAll(rows);                 // one sdk.bulkDecrypt(...) per (table, column)
console.log(rows[0].email.decrypt());   // synchronous; cached plaintext
```

`decryptAll` walks the result set, collects every envelope it finds (across nested objects + arrays), and bulk-decrypts each routing-key group in parallel. After `decryptAll`, every touched envelope's `decrypt()` returns synchronously without an SDK call.

### Migrating

There is no hand-authored `migration.ts` for cipherstash columns. The user runs the standard Prisma Next migrate workflow:

```
$ prisma-next migrate            # produces migrations for the user's app space
                                 # AND the cipherstash extension's space
$ prisma-next db apply           # runs both spaces' migrations against the DB
```

What happens behind the scenes:

1. **`prisma-next migrate` (emit time).** The framework emits a fresh `contract.json` for the user's application space. As part of that emit, every codec referenced in the contract gets its `onFieldEvent` lifecycle hook called once per changed field (added / dropped / altered). Cipherstash's hook (the part of `@prisma-next/extension-cipherstash` shipped under `./control`) inspects the field's typeParams. For an `Encrypted<string>` field with `searchable: true` (or with the equivalent `equality` / `freeTextSearch` typeParams), it emits an op into the user's app-space migration:

   ```jsonc
   // user's app-space migrations/<id>/ops.json
   [
     { "op": "create_table", "table": "user", … },                        // user's structural op
     {                                                                     // codec-emitted op
       "op": "data",
       "invariantId": "cipherstash-codec:user.email:add-search-config@v1",
       "execute": [
         "SELECT eql_v2.add_search_config('user', 'email', 'unique', 'text');",
         "SELECT eql_v2.add_search_config('user', 'email', 'match', 'text');"
       ]
     }
   ]
   ```

   The cipherstash extension space gets its own migration set — the extension declares an `eql_v2_configuration` table (and the schemas/types EQL needs in `meta.cipherstashFutureIR`) and a baseline migration whose ops include a `cipherstash:install-eql-bundle-v1` op carrying the full EQL bundle SQL byte-for-byte. The framework writes both spaces' migration directories under the user's `migrations/` tree:

   ```
   migrations/
   ├── app/                                  # user's application contract space
   │   └── 001-add-encrypted-user-email/
   │       ├── ops.json
   │       └── …
   └── cipherstash/                          # cipherstash's contract space
       └── 001-baseline/
           ├── ops.json                       # install-eql-bundle-v1 + structural ops
           └── …
   ```

2. **`prisma-next db apply`.** The runner walks both spaces' DAGs from each space's marker row (one row per space in `prisma_contract.marker`), applies the ops it needs to reach each space's head, and updates the marker. Both spaces are applied in a single transaction; ordering between spaces is governed by the framework's invariant-aware path resolver — the cipherstash space's `eql_v2_configuration` table must exist before the codec-emitted `add_search_config` op runs, which the path resolver guarantees because the codec-emitted op declares an invariant on `cipherstash:eql-v2-configuration@v1`.

3. **Re-running `db apply` is idempotent.** Both spaces' marker rows record the applied head; applying again with no change is a no-op. The strict per-space verifier confirms the live database matches each space's contract; an extra column added by hand to `eql_v2_configuration` would fail strict mode loudly.

The user never writes a migration file for cipherstash columns. That's the central architectural promise of contract spaces: extensions contribute to the user's schema through the same authoring → emit → migrate → apply pipeline the user uses for their own tables, but with the extension owning its own space and its own migrations rather than installing schema via a side-channel.

**For Project 2:** when `dbInit` / `dbUpdate` evolves to handle structural type changes (e.g. flipping a column's flags after rows exist, or migrating a plain `string` column to `Encrypted<string>`), the same codec lifecycle hook handles them — `onFieldEvent('altered', …)` already exists on the SPI. Project 1 covers added / dropped / typeParams-altered.

---

## Integration surface — what we call on your products

The extension talks to your products through three boundaries.

### 1. The framework-native CipherStash SDK contract

Internally we abstract your client SDK behind a minimal three-method interface:

```ts
export interface CipherstashSdk {
  decrypt(args: {
    ciphertext: unknown;
    table: string;
    column: string;
    signal?: AbortSignal;
  }): Promise<string>;

  bulkEncrypt(args: {
    routingKey: { table: string; column: string };
    values: ReadonlyArray<string>;
    signal?: AbortSignal;
  }): Promise<ReadonlyArray<unknown>>;

  bulkDecrypt(args: {
    routingKey: { table: string; column: string };
    ciphertexts: ReadonlyArray<unknown>;
    signal?: AbortSignal;
  }): Promise<ReadonlyArray<string>>;
}
```

This sits on top of your richer `EncryptionClient` from `@cipherstash/stack`. The extension package ships a thin adapter mapping this three-method interface onto your client; users instantiate the adapter once at runtime construction time and pass the `CipherstashSdk` into the cipherstash extension pack.

Three methods, three distinct call sites:

- `decrypt` — single-cell read used by `EncryptedString#decrypt()` when the user opts out of bulk decryption.
- `bulkEncrypt` — write-side coalesced encrypt, called once per `(table, column)` group per query from the bulk-encrypt middleware in `beforeExecute`.
- `bulkDecrypt` — read-side coalesced decrypt, called once per `(table, column)` group per `decryptAll(...)` call.

Each method takes an optional `AbortSignal`. The signal forwards by reference identity from the caller's `runtime.execute({ signal })` (or `decryptAll({ signal })`) to your SDK on every call. If the signal aborts mid-flight, our middleware surfaces `RUNTIME.ABORTED` with phase attribution back to the user.

### 2. The wire shape — `eql_v2_encrypted` Postgres native type

The codec encodes envelopes to wire and decodes them back:

- **Encode** reads `ciphertext` from the envelope's internal handle (populated by the bulk-encrypt middleware moments earlier) and emits it as the column's `eql_v2_encrypted` JSONB value.
- **Decode** reads the wire JSONB and constructs an `EncryptedString` envelope carrying the ciphertext + the `(table, column)` routing context + the SDK reference, so a later `envelope.decrypt(...)` knows where to call.

We treat the wire shape as opaque. Whatever your EQL install puts on disk (the `i.t` / `i.c` schema markers etc.) is your concern; we round-trip it byte-for-byte.

### 3. EQL search-config registration via raw SQL

The codec lifecycle hook (`onFieldEvent` on the cipherstash codec descriptor) emits `add_search_config` / `remove_search_config` ops automatically as the user adds, drops, or alters `Encrypted<string>` fields. A flagged `equality: true` emits an `add_search_config('table', 'column', 'unique', 'text')` op; `freeTextSearch: true` emits one for `'match'`. The op's `execute[]` payload may carry both statements when both flags are enabled — implementation can choose one op with multi-statement execute or two separate ops; either fits the runner. The framework's `activate_pending_searches` semantics (whether it needs to be invoked once per migration, or whether the per-field ops handle activation themselves) is one of the open questions we'd like your input on — see § Open design questions.

We plan to defer to your existing `operation-templates.ts` from the `cipherstash/stack` reference repo as the source of truth for the exact SQL function calls. If you've evolved that surface since the first-attempt repo, point us at the current canonical reference.

---

## Architecture in brief

The package is organized along the boundaries Prisma Next's extension protocol expects:

```
@prisma-next/extension-cipherstash
│
├── ./control                                      (consumed at migration time)
│   ├── cipherstashContractSpace                   (own contract.json + baseline migration with EQL bundle)
│   ├── cipherstash.EncryptedString({...})         (PSL constructor, registered in pack meta)
│   ├── cipherstash/string@1 codec descriptor      (codec id + targetTypes + traits)
│   └── onFieldEvent lifecycle hook                (emits add_search_config/remove_search_config/rotate ops
│                                                   into the user's app-space migration)
│
├── ./runtime                                      (consumed at query time)
│   ├── EncryptedString                            (envelope class, public surface)
│   ├── cipherstash/string@1 codec runtime         (encode/decode for eql_v2_encrypted)
│   └── decryptAll(rows)                           (read-side coalescing utility)
│
├── ./middleware                                   (consumed at query time)
│   └── bulkEncryptMiddleware                      (SQL middleware, write-side coalescing)
│
└── ./column-types                                 (consumed at TS authoring time)
    └── encryptedString({...})                     (TS authoring factory)
```

The split between `./control` and `./runtime` is load-bearing for tree shaking — apps that only emit migrations (CLI tooling, schema verification, codegen) never load the runtime; apps that only run queries never load the contract-space artefacts.

The envelope class is the load-bearing abstraction. It owns its internal handle privately (no exported handle type, no public accessors leak the plaintext or ciphertext slots), and it is the only object that crosses both directions of the codec boundary. On the write side, the envelope is constructed by the user with plaintext; the middleware mutates its handle to install the ciphertext; the codec reads the ciphertext and emits to wire. On the read side, the codec constructs the envelope with the wire ciphertext + routing context + SDK reference; the user later calls `decrypt()` or `decryptAll()` to materialize plaintext.

The codec itself is intentionally thin — it does not contain SDK references in its hot path nor manage concurrency, batch sizing, abort handling, or error attribution. Those concerns live in the middleware (write side) and `decryptAll` (read side), where they sit at the right granularity for amortization.

The bulk-encrypt middleware consumes a Prisma Next framework SPI we shipped specifically for this use case (`SqlParamRefMutator` in M1 of this project). It walks the parameter list of each query, filters by codec id (`cipherstash/string@1`), groups by `(table, column)`, and rewrites each group's plaintexts to ciphertexts via one `sdk.bulkEncrypt(...)` call. When no cipherstash columns are involved, the middleware short-circuits via reference-identity — the no-cipherstash hot path pays zero allocation cost.

---

## Performance profile

The cost contract is **bulk amortization, both directions**:

- **Write side.** A query inserting *N* rows where each row carries values for *K* distinct cipherstash routing keys issues exactly *K* `bulkEncrypt` calls. *K* is typically 1 (single-table, single-encrypted-column queries).
- **Read side.** A `decryptAll(rows)` call over *N* envelopes spanning *K* routing keys issues exactly *K* `bulkDecrypt` calls.

Single-cell `envelope.decrypt()` issues one `sdk.decrypt(...)` per call. Users opt into bulk decryption explicitly via `decryptAll`. The framework never silently materializes plaintext — every cell that gets decrypted goes through a method call the user wrote.

Encryption happens at **encode time**, not commit time. The middleware runs in the runtime's `beforeExecute` phase, ahead of the codec's encode pass; by the time the wire-row reaches the database driver, the envelope's ciphertext has already been written. This keeps the cost predictable and the failure mode clean (an SDK error fails the query before it touches the database).

---

## Security model

- **Plaintext lifecycle.** Plaintext lives in the user's params object (their call to `db.insert({...})`) and on the envelope's internal handle from `EncryptedString.from(...)` until the user releases their reference. After the bulk-encrypt middleware runs, the handle now holds both plaintext and ciphertext; we do **not** zero the plaintext slot post-encrypt (see § Open design questions). As a deliberate side effect, a write-side `envelope.decrypt()` returns the original plaintext synchronously without an SDK call.
- **Wire form.** Encrypted columns are `eql_v2_encrypted` JSONB cells. The framework sees them as opaque `unknown`-typed bytes; the codec does not deserialize the embedded EQL schema markers.
- **Envelope identity.** The handle is package-private — no public TypeScript accessor returns it, and a negative type test pins the constraint at compile time. `Object.keys(envelope)` returns `[]`; `JSON.stringify(envelope)` returns `{ "$encryptedString": "<opaque>" }`. Consumers cannot read the ciphertext directly through the envelope.
- **Cancellation.** `AbortSignal` flows from `runtime.execute({ signal })` through the per-execute `MiddlewareContext.signal` into every SDK call (single decrypt, bulk encrypt, bulk decrypt). An aborted signal at middleware entry surfaces `RUNTIME.ABORTED { phase: 'beforeExecute' }`; mid-flight aborts surface promptly via a sentinel-identity race against the SDK promise.
- **Threat model boundary.** Standard JS heap exposure applies — anything alive on the user's heap (user params, envelope handles) is reachable from a heap dump until garbage collection. We do not attempt out-of-process key custody. Strict-hygiene users drop envelope references promptly themselves; once nothing holds the envelope, GC reclaims everything on the handle.

---

## Operational model

A user adopting the extension goes through three phases:

1. **Bootstrap.** `prisma-next db apply` runs once per database (or as part of every deploy). The cipherstash extension contributes its own contract space; the framework's runner walks that space's migration DAG from its marker row and applies what's missing. The first run executes the cipherstash baseline migration, which includes the `cipherstash:install-eql-bundle-v1` op carrying your `eql-bundle.ts` SQL byte-for-byte. Subsequent runs are idempotent — the marker row records the applied head; re-running with no change is a no-op.
2. **Schema evolution.** When the user adds an `EncryptedString` column or changes its mode flags, they run `prisma-next migrate`. The codec lifecycle hook fires per-field-delta during emit and produces the `add_search_config` / `remove_search_config` / rotate ops in the **app-space** migration's `ops.json` automatically. The user does not author the migration file — they edit their PSL/TS contract and run `migrate`. `db apply` then runs both spaces' migrations.
3. **Runtime.** The user's app runs queries normally. The bulk-encrypt middleware runs on every query but no-ops when no cipherstash params are present. Operator lowering is gated by codec id — `eq`/`ilike` against an `eql_v2_encrypted` column produces EQL function calls; the same operators against ordinary text columns are unaffected.

EQL bundle versioning: today our plan is to vendor the install SQL and ship updates via new extension package releases. If you have a maintained source we should pull from instead (a versioned npm package, a release artifact, an upstream repo we can pin to a tag), we'd prefer that — see § Open design questions below.

---

## Open design questions

Two design defaults shipped today touch user-visible behavior; we'd value validation:

1. **Routing-key derivation.** We derive the routing key from `(table, column)` and emit one `bulkEncrypt` per group, with no per-column override on `encryptedString({...})`. The alternative — heterogeneous per-query batches via your `bulkEncryptModels` shape — is fewer round-trips but a different SDK contract. We picked the homogeneous shape; we'd want to know if multi-tenant patterns or per-row routing-key variations push for the heterogeneous shape.
2. **Plaintext zeroing post-encrypt.** We do not zero the plaintext slot on the envelope handle after encryption. The win in JS is bounded (string immutability means we can't actually overwrite the bytes; we'd just narrow the GC window) and we get a useful side effect from not zeroing — synchronous post-write `decrypt()` without an SDK call. We'd want to know if this differs from your team's recommended posture.

The full framing — including what changes for each "no" answer, the trade-offs we evaluated, and concrete questions phrased for your team — is in `[cipherstash-team-questions.md](cipherstash-team-questions.md)`. It also raises three lower-priority topics: EQL bundle vendoring strategy, live-EQL test infrastructure, and the canonical source for operator-lowering templates.

---

## Out of scope (Project 1)

The following are deliberately deferred:

- **Other cipherstash column types.** `EncryptedNumber`, `EncryptedDate`, `EncryptedBoolean`, `EncryptedJson`. The envelope-codec pattern generalizes cleanly to any of these; Project 1 ships `EncryptedString` as the proof of pattern.
- **Other operator families.** `orderAndRange` (range queries), `searchableJson`. Project 1 ships `equality` + `freeTextSearch` only.
- **Heterogeneous bulk-encrypt.** See § Open design questions above. Today: one `bulkEncrypt` per `(table, column)` group.
- **Selective `decryptAll`.** First-pass walks every envelope. Selective convenience (`decryptAll(rows, { columns: ['email'] })`) is a follow-up if there's demand.
- **Streaming-time decryption.** The framework's streaming query path doesn't try to decrypt mid-iteration. Users decrypt per-cell or post-buffer + `decryptAll`.
- `**envelope.dispose()` API.** No explicit zeroization knob. Users with strict hygiene drop envelope references; once unreachable, GC handles the rest. If real customer demand surfaces, this is a small additive change.
- **KMS-provider abstraction.** Different KMS products have different bulk-call shapes, routing semantics, error taxonomies, cancellation contracts. We do not ship a generic `@prisma-next/extension-kms-base`; the abstraction is the *pattern* (envelope class, codec, middleware, `decryptAll`), not a base class. If multiple KMS extensions converge on a clean common shape, that's a future factor-out.

---

## Comparison with the existing cipherstash/stack prisma plugin

Your existing `cipherstash/stack/packages/stack/src/prisma/` plugin integrates with the original Prisma ORM, which is a fundamentally different host: schema-driven code generation, runtime client objects, Prisma's own query builder. Our extension targets Prisma Next, which is contract-first and schema-driven differently — schemas compile to a JSON contract, the runtime is built on a typed query DSL that reads the contract, and extensions plug into the contract emitter and the runtime middleware chain rather than into a generated client.

Concretely, the things that map cleanly:

- Your `eql-bundle.ts` install script → our cipherstash contract space's baseline migration, which carries the same SQL byte-for-byte as the body of one op.
- Your `operation-templates.ts` for EQL operator SQL shapes → our operator-lowering implementation in M3 (we'll consume the same templates).
- Your `EncryptionClient` (lazy-init, schemas, etc.) → we wrap it in our minimal three-method `CipherstashSdk` interface, leaving your client's lifecycle and schema management untouched.

The things that differ structurally:

- Authoring: PSL constructor + TS factory parity, with a single canonical `cipherstash.EncryptedString({...})` shape that both lower to. Your Prisma plugin extends Prisma's schema language; we extend ours.
- Runtime: a pluggable middleware chain in `beforeExecute` (the bulk-encrypt middleware is one such middleware), versus your plugin's hooks into Prisma's own client lifecycle.
- Migrations: contract spaces. The cipherstash extension owns its own slice of the user's database (contract.json + baseline migration on disk, marker row in `prisma_contract.marker`), and a codec lifecycle hook emits per-column EQL ops into the user's app-space migration as they edit their schema. The user never hand-authors `addSearchConfig` calls — the framework derives them from the contract diff.

Project 1 deliberately keeps the surface narrow so the integration shape is reviewable. Once it lands, your team can fork the extension's runtime layer to track CipherStash's evolution — the framework SPI it consumes (raw-SQL AST, param-mutator middleware seam) is stable; the cipherstash-specific layers (envelope, codec, middleware, factories) can evolve at your cadence.

---

## What we want from this conversation

If we get a few minutes with you:

- Walk through the integration surface above and confirm we're calling into your products in shapes that match how you expect customers to use them.
- Validate the two open design defaults — routing-key derivation and plaintext zeroing — against what you've seen from customers.

If we get longer:

- Talk through the EQL bundle vendoring strategy. We'd rather pull from a versioned source than vendor a snapshot, but only if a stable source exists.
- Talk through live-EQL integration testing. We have a Postgres-in-containers harness; the cipherstash contract space's baseline migration installs EQL on first apply, so test setups don't need a separate bootstrap step. If you have a recommended test setup we should mirror, we'd take that over inventing our own.
- Talk through the operator-lowering shape (M3, not currently in flight). We're planning to defer to `operation-templates.ts` as the source of truth — confirm that's still canonical.

Project 1 ships the runtime layer (envelope, SDK interface, codec encode/decode, bulk-encrypt middleware, PSL constructor, TS factory, operator lowering) on top of the contract-spaces foundation already shipped in TML-2397. Once Project 1 ships, the cipherstash extension is something your team can iterate on directly. This conversation is about making sure the defaults we ship don't paint your team into a corner when you take ownership.