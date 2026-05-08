# @prisma-next/extension-cipherstash

[CipherStash](https://cipherstash.com) extension for Prisma Next: searchable application-layer encryption for Postgres via the EQL bundle.

## Status

In development. The currently-implemented surface is the **storage path**:

- `EncryptedString` envelope and `cipherstash/string@1` codec runtime,
- `cipherstash.EncryptedString({...})` PSL constructor and the `encryptedString({...})` TS contract factory (byte-identical lowering),
- `SqlControlExtensionDescriptor` carrying the EQL contract space (eql_v2_configuration table, eql_v2_encrypted / ore_* composite types, eql_v2 domains) plus a baseline migration that installs the vendored EQL bundle SQL.

The bulk-encrypt middleware, the live-Postgres storage round-trip, and the search operators (`cipherstashEq`, `cipherstashIlike`) have shipped on the cipherstash storage path. `decryptAll` and the live-Postgres + EQL bundle exercise of the lowered search SQL ship in subsequent releases. See [`DEVELOPING.md`](./DEVELOPING.md) — forthcoming surface.

Search operators are deliberately exposed under the cipherstash-namespaced names `cipherstashEq` and `cipherstashIlike` rather than the framework's built-in `eq` / `ilike`. The cipherstash codec declares no `equality` codec trait, so the framework's trait-gated `eq` is not reachable on cipherstash columns — calling `email.eq(...)` on a cipherstash column is `undefined`. Equality search uses `email.cipherstashEq(value)`, which lowers to `eql_v2.eq(...)`; free-text search uses `email.cipherstashIlike(pattern)` lowering to `eql_v2.ilike(...)`. The user-facing `EncryptedString({ equality: true })` flag is unrelated to the codec trait — it controls whether the codec lifecycle hook emits an `add_search_config` op for the column's `unique` index at migration time.

## Subpath exports


| Subpath          | Purpose                                                       |
| ---------------- | ------------------------------------------------------------- |
| `./control`      | `SqlControlExtensionDescriptor` (contract space + pack meta)  |
| `./runtime`      | `EncryptedString` envelope + `CipherstashSdk` + codec runtime |
| `./pack`         | `cipherstashPackMeta` for TS contract authoring               |
| `./column-types` | `encryptedString({ equality?, freeTextSearch? })` TS factory  |


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

```ts
import { EncryptedString } from '@prisma-next/extension-cipherstash/runtime';

const envelope = EncryptedString.from('alice@example.com');
const plaintext = await envelope.decrypt();
```

## Contributing

See [`DEVELOPING.md`](./DEVELOPING.md) for source layout, in-progress milestones, and design choices.

## References

- [CipherStash](https://cipherstash.com) — managed application-layer encryption for Postgres.
- [Prisma Next Architecture Overview](../../../docs/Architecture%20Overview.md).
- [Extension Packs Naming and Layout](../../../docs/reference/Extension-Packs-Naming-and-Layout.md).
