# @prisma-next/extension-cipherstash

[CipherStash](https://cipherstash.com) extension for Prisma Next: searchable application-layer encryption for Postgres via the EQL bundle.

## What this package provides

- `EncryptedString` envelope + `cipherstash/string@1` codec runtime — the runtime side of the field-level encryption.
- `cipherstash.EncryptedString({...})` PSL constructor and the `encryptedString({...})` TS contract factory (byte-identical lowering).
- `SqlControlExtensionDescriptor` carrying the EQL contract space (the `eql_v2_configuration` table, the `eql_v2_encrypted` / `ore_*` composite types, the `eql_v2` domains) plus a baseline migration that installs the vendored EQL bundle SQL.
- `bulkEncryptMiddleware(sdk)` — coalesces `EncryptedString` parameters into one `bulkEncrypt` SDK call per `(table, column)` before the wire encode.
- `cipherstashEq(value)` / `cipherstashIlike(pattern)` query operations — lower to `eql_v2.eq(...)` / `eql_v2.ilike(...)` on cipherstash columns.
- `decryptAll(rows, opts?)` — opt-in read-side amortization that walks a result set, coalesces every `EncryptedString` it finds into one `bulkDecrypt` SDK call per `(table, column)` group, and caches the resolved plaintexts back onto each envelope so subsequent `envelope.decrypt()` calls return synchronously without consulting the SDK.

Search operators are deliberately exposed under the cipherstash-namespaced names `cipherstashEq` and `cipherstashIlike` rather than the framework's built-in `eq` / `ilike`. The cipherstash codec declares no `equality` codec trait, so the framework's trait-gated `eq` is not reachable on cipherstash columns — calling `email.eq(...)` on a cipherstash column is `undefined` (typechecks as a no-such-method error). Equality search uses `email.cipherstashEq(value)`, which lowers to `eql_v2.eq(...)`; free-text search uses `email.cipherstashIlike(pattern)` lowering to `eql_v2.ilike(...)`. The user-facing `EncryptedString({ equality: true })` flag is unrelated to the codec trait — it controls whether the codec lifecycle hook emits an `add_search_config` op for the column's `unique` index at migration time.

## Subpath exports


| Subpath          | Purpose                                                       |
| ---------------- | ------------------------------------------------------------- |
| `./control`      | `SqlControlExtensionDescriptor` (contract space + pack meta)  |
| `./runtime`      | `EncryptedString` envelope + `CipherstashSdk` + codec runtime + `decryptAll` |
| `./middleware`   | `bulkEncryptMiddleware(sdk)`                                  |
| `./pack`         | `cipherstashPackMeta` for TS contract authoring               |
| `./column-types` | `encryptedString({ equality?, freeTextSearch? })` TS factory  |

The `./control` and `./runtime` / `./middleware` planes are tree-shakable: a runtime consumer never pulls the EQL bundle SQL or the codec lifecycle hook, and a control-plane consumer never pulls the SDK interface, the codec runtime, or the bulk-encrypt middleware. See [`DEVELOPING.md`](./DEVELOPING.md) — design choices.


## Configuration

Add the extension to your `prisma-next.config.ts`:

```ts
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';
import cipherstash from '@prisma-next/extension-cipherstash/control';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensionPacks: [cipherstash],
});
```

## Authoring

### PSL

```prisma
model User {
  id    Int @id @default(autoincrement())
  email cipherstash.EncryptedString({ equality: true })
  notes cipherstash.EncryptedString({})?
}
```

### TypeScript

```ts
import { encryptedString } from '@prisma-next/extension-cipherstash/column-types';
import cipherstash from '@prisma-next/extension-cipherstash/pack';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import postgres from '@prisma-next/target-postgres/pack';

export const contract = defineContract({
  family: sqlFamily,
  target: postgres,
  extensionPacks: { cipherstash },
  models: {
    User: model('User', {
      fields: {
        id: field.column({ codecId: 'pg/int4@1', nativeType: 'int4' })
          .defaultSql('autoincrement()').id(),
        email: field.column(encryptedString({ equality: true })),
        notes: field.column(encryptedString({})).optional(),
      },
    }).sql({ table: 'user' }),
  },
});
```

Both authoring forms emit byte-identical `contract.json`. The codec registers under the `cipherstash/string@1` codec id and maps to the EQL `eql_v2_encrypted` Postgres native type. Per-column search-mode parameters (`equality`, `freeTextSearch`) are validated at the contract boundary by an arktype schema and threaded through the parameterized-codec descriptor model — see [ADR 208 — Higher-order codecs for parameterized types](../../../docs/architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md). The codec's `decode` site reads the cell's `(table, column)` from the per-call codec context — see [ADR 207 — Codec call context per-query AbortSignal and column metadata](../../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md).

## Database setup

The extension contributes its database scaffolding (the `eql_v2_configuration` table, the `eql_v2_encrypted` / `ore_*` composite types, the `eql_v2.bloom_filter` / `hmac_256` / `blake3` domains, and the EQL bundle SQL) as a **contract space** so the Prisma Next framework can plan, apply, and verify it the same way it manages an application's own schema.

After `prisma-next migrate plan`, the user's repo gains:

- `migrations/cipherstash/contract.json`,
- `migrations/cipherstash/contract.d.ts`,
- `migrations/cipherstash/refs/head.json`,
- `migrations/cipherstash/<name>/` migration directories.

`db apply` then runs CipherStash's migrations against the live database in the same transaction as any application-space migration emitted in the same `migrate` invocation.

## Runtime usage

A worked end-to-end example lives at [`examples/cipherstash-integration/`](../../../examples/cipherstash-integration/) — schema, runtime composition, demo SDK stub, and an `insert` → `cipherstashEq` → `cipherstashIlike` → `decryptAll` flow against a real Postgres database.

The minimal runtime composition wires the cipherstash runtime descriptor and the bulk-encrypt middleware into the SQL runtime (sharing one SDK binding):

```ts
import { bulkEncryptMiddleware } from '@prisma-next/extension-cipherstash/middleware';
import {
  createCipherstashRuntimeDescriptor,
  decryptAll,
  EncryptedString,
} from '@prisma-next/extension-cipherstash/runtime';
import postgres from '@prisma-next/postgres/runtime';
import type { Contract } from './prisma/contract.d';
import contractJson from './prisma/contract.json' with { type: 'json' };

const sdk = /* your CipherstashSdk implementation */;

const db = postgres<Contract>({
  contractJson,
  extensions: [createCipherstashRuntimeDescriptor({ sdk })],
  middleware: [bulkEncryptMiddleware(sdk)],
});

await db.orm.User.create({ id: 'u1', email: EncryptedString.from('alice@example.com') });

const rows = await db.orm.User.where((u) => u.email.cipherstashEq('alice@example.com')).all();
await decryptAll(rows);
console.log(await rows[0]?.email.decrypt());
```

`EncryptedString.from(plaintext)` creates a write-side envelope; the bulk-encrypt middleware fills in the ciphertext at execute time. Read-side envelopes are constructed by the codec's `decode` and carry their `(table, column)` routing key for `decrypt` / `decryptAll`.

## Security model

- **Plaintext lifetime**. The write-side handle retains its plaintext slot post-encrypt — JS strings are immutable and zeroing is best-effort, so the GC-driven lifecycle is the sufficient bound. Practical implication: the original `EncryptedString.from(plaintext)` envelope's `decrypt()` returns the plaintext synchronously without consulting the SDK. Treat envelope objects as plaintext-equivalent for the lifetime of the variable.
- **Ciphertext routing**. Every read-side envelope carries the `(table, column)` it was decoded from; `decrypt` / `decryptAll` route their bulk SDK calls by that key so the SDK can pick the right key material per column.
- **Operator semantics**. Encrypted equality uses `eql_v2.eq` (deterministic-index lookup); encrypted free-text uses `eql_v2.ilike` (bloom-filter lookup). The framework's built-in `eq` / `ilike` are unreachable on cipherstash columns — the codec declares zero traits so no wrong-SQL footgun can exist where a randomized EQL ciphertext is compared with `=` directly.
- **Cancellation**. Every cipherstash-internal SDK call accepts an `AbortSignal`; mid-flight cancellation surfaces a `RUNTIME.ABORTED` envelope with a phase tag (`bulk-encrypt`, `decrypt`, or `decrypt-all`) mirroring the framework's envelope shape from [ADR 207](../../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md).

## Contributing

See [`DEVELOPING.md`](./DEVELOPING.md) for source layout, design choices, and the canonical Acceptance Criteria list.

## References

- [CipherStash](https://cipherstash.com) — managed application-layer encryption for Postgres.
- [Prisma Next Architecture Overview](../../../docs/Architecture%20Overview.md).
- [Extension Packs Naming and Layout](../../../docs/reference/Extension-Packs-Naming-and-Layout.md).
