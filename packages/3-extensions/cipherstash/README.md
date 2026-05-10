# @prisma-next/extension-cipherstash

[CipherStash](https://cipherstash.com) extension for Prisma Next: searchable
application-layer encryption for Postgres via the EQL bundle.

## Status

Work in progress. This package documents the current supported behavior only.

This package authors CipherStash's database scaffolding (the
`eql_v2_configuration` table, the `eql_v2_encrypted` / `ore_*` composite
types, the `eql_v2.bloom_filter` / `hmac_256` / `blake3` domains, and the
EQL bundle SQL) as a **contract space** so the Prisma Next framework can
plan, apply, and verify it the same way it manages an application's own
schema.

The `searchable: true` codec lifecycle hook (`add_search_config` /
`remove_search_config` ops) is wired up — see `src/exports/control.ts`. The
codec runtime (encoding/decoding `Encrypted<string>` payloads at query time)
is not yet implemented.

## What this package contributes

- `contractSpace.contractJson` — the typed objects EQL exposes that user
  columns can name as `nativeType`. Per the IR vocabulary boundary,
  this carries tables / enums / composite types / domains only; functions /
  operators / casts / op classes live below the boundary as opaque DDL inside
  the `installEqlBundle` migration op.
- `contractSpace.migrations` — the baseline migration that installs the
  vendored EQL bundle SQL (one `cipherstash:install-eql-bundle-v1` op
  carrying the bundle byte-for-byte) plus the structural ops that create
  the typed objects above. Each op carries a `cipherstash:*` invariantId.
- `contractSpace.headRef` — `(hash, invariants)` describing the current
  target state of the contract space. The framework consumes this at
  `migrate` time to materialise pinned per-space artefacts under
  `migrations/cipherstash/` in the user's repo.

## Usage (preview)

```ts
import { defineConfig } from 'prisma-next';
import cipherstash from '@prisma-next/extension-cipherstash/control';

export default defineConfig({
  extensionPacks: [cipherstash],
});
```

After `prisma-next migrate`, the user's repo gains
`migrations/cipherstash/contract.json`,
`migrations/cipherstash/contract.d.ts`,
`migrations/cipherstash/refs/head.json`, and
`migrations/cipherstash/<name>/` migration directories. `db apply` then
runs CipherStash's migrations against the live database in the same
transaction as any application-space migration emitted in the same
`migrate` invocation.

## See also

- Reference fixture: [`packages/3-extensions/test-contract-space`](../test-contract-space)
- Reference shape: [`packages/3-extensions/pgvector`](../pgvector)
