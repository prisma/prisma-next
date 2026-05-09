# @prisma-next/extension-cipherstash

[CipherStash](https://cipherstash.com) extension for Prisma Next: searchable
application-layer encryption for Postgres via the EQL bundle.

## Status

Authored as a **contract space** per
[ADR 211 — Contract spaces](../../../docs/architecture%20docs/adrs/ADR%20211%20-%20Contract%20spaces.md)
(Linear: [TML-2397](https://linear.app/prisma/issue/TML-2397)).

This package authors CipherStash's database scaffolding (the
`eql_v2_configuration` table, the `eql_v2_encrypted` / `ore_*` composite
types, the `eql_v2.bloom_filter` / `hmac_256` / `blake3` domains, and the
EQL bundle SQL) as a contract space, so the Prisma Next framework can
plan, apply, and verify it the same way it manages an application's own
schema.

The codec runtime (encoding/decoding `Encrypted<string>` payloads) and the
`searchable: true` codec lifecycle hook for `add_search_config` /
`remove_search_config` ops (see
[ADR 212 — Codec lifecycle hooks](../../../docs/architecture%20docs/adrs/ADR%20212%20-%20Codec%20lifecycle%20hooks.md))
are intentionally **not** in this round.

## What this package contributes

- `contractSpace.contractJson` — the typed objects EQL exposes that user
  columns can name as `nativeType`. Per the IR vocabulary boundary in
  the project spec, this carries tables / enums / composite types /
  domains only; functions / operators / casts / op classes live below
  the boundary as opaque DDL inside the `installEqlBundle` migration op.
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

## Authoring (maintainers)

The extension's contract + baseline migration are emitted on-disk inside
this package using the same pipeline application authors use:

- `pnpm build:contract-space` — runs `prisma-next contract emit` to
  produce `<package>/contract.{json,d.ts}` from the TS source at
  `src/contract-source.ts`.
- `prisma-next migration plan` (run inside the package) — scaffolds a
  new migration directory under `migrations/cipherstash/<dirName>/`.
  The baseline migration's `migration.ts` is then hand-edited so that
  its `operations` getter installs the EQL bundle byte-for-byte plus
  the structural `cipherstash:*` no-op ops that register invariantIds
  for typed objects the bundle creates (see the comment in
  `migrations/cipherstash/20260601T0000_install_eql_bundle/migration.ts`).
- `node migration.ts` (run inside the migration directory) — re-emits
  `ops.json` + `migration.json` from the hand-edited subclass.
- `refs/head.json` is hand-pinned with the latest migration's `to`
  hash + `providedInvariants`.

The descriptor at `src/exports/control.ts` then JSON-imports those
artefacts and synthesises the framework's `MigrationPackage` shape
(with `dirPath` resolved from `import.meta.url`).

See [ADR 211 — Contract spaces](../../../docs/architecture%20docs/adrs/ADR%20211%20-%20Contract%20spaces.md)
("On-disk-in-package authoring convention") for the full rationale and
[`packages/3-extensions/test-contract-space`](../test-contract-space)
for the reference model.

## See also

- [ADR 211 — Contract spaces](../../../docs/architecture%20docs/adrs/ADR%20211%20-%20Contract%20spaces.md)
- [ADR 212 — Codec lifecycle hooks](../../../docs/architecture%20docs/adrs/ADR%20212%20-%20Codec%20lifecycle%20hooks.md)
- [Subsystem doc — Ecosystem Extensions & Packs](../../../docs/architecture%20docs/subsystems/6.%20Ecosystem%20Extensions%20%26%20Packs.md)
- Reference fixture: [`packages/3-extensions/test-contract-space`](../test-contract-space)
- Reference shape: [`packages/3-extensions/pgvector`](../pgvector)
