---
from: "0.12"
to: "0.13"
changes:
  - id: regen-extension-contracts-strip-empty-type-params
    summary: |
      The canonicalizer now strips empty `typeParams: {}` from `storage.types` entries in
      `contract.json`. Any extension that has shipped a `contract.json` with `typeParams: {}`
      on its named-type entries (e.g. `types { Uuid = String @db.Uuid }`) must re-emit its
      contract artefacts and re-pin its migration baselines so the on-disk hashes match the
      new canonical form.
    detection:
      glob: "**/contract.json"
      contains:
        - '"typeParams": {}'
      anyMatch: true
  - id: thread-namespace-id-through-codec-ref-resolver-spi
    summary: |
      The codec-resolution SPI in `@prisma-next/sql-relational-core` now takes a leading, required `namespaceId` coordinate. The `CodecDescriptorRegistry.codecRefForColumn(table, column)` build-time helper — the one AST authors call to stamp `codec` onto every column-bound `ParamRef` / `ProjectionItem`, exported from `@prisma-next/sql-relational-core/query-lane-context` and `@prisma-next/sql-relational-core/codec-descriptor-registry` — is now `codecRefForColumn(namespaceId, table, column)`. The underlying free function `codecRefForStorageColumn(storage, table, column)` (exported from `@prisma-next/sql-relational-core/codec-descriptor-registry`) is now `codecRefForStorageColumn(storage, namespaceId, table, column)`. Extension authors who derive codec refs directly must thread the namespace the table sits in at every call site: pass the explicit `namespaceId` ahead of `table`. There is no codemod — the right namespace is call-site-specific (read it from the model/table you are building the ref for). Two same-bare-named tables in different namespaces now resolve to their own per-namespace columns/codecs instead of the first scan hit.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "codecRefForColumn("
        - "codecRefForStorageColumn("
      anyMatch: true
---

<!--
TML-2843: @prisma-next/sqlite gained a facade-level transaction API
(`SqliteClient.transaction()` + `SqliteTransactionContext`), mirroring
the existing Postgres facade. Purely additive public surface backed by
the unchanged SQL runtime `withTransaction` helper; existing extension
code is unaffected. Incidental substrate diff only.

TML-2838: vitest configs in `packages/3-extensions/postgres` and
`packages/3-extensions/supabase` now pass `--no-memory-protection-keys`
to the test worker forks to stop a V8 WASM-teardown crash on Linux CI.
Test-harness only — no runtime, contract, or public-API change.
Incidental substrate diff only.

TML-2500 M4: `packages/3-extensions/supabase/README.md` link updated
from the old project spec to the canonical ecosystem-extensions doc and
ADR 226. Docs-only; no runtime, contract, or public-API change.
Incidental substrate diff only.

TML-2784: many-to-many became a first-class, validatable contract shape.
`ContractReferenceRelation` is now a cardinality-discriminated union — the
`'N:M'` variant requires a `through` junction descriptor ({ table,
namespaceId, parentColumns, childColumns, targetColumns }); the
non-junction variant carries `through?: never`. Purely additive: N:M
contracts did not validate before this change, so no working extension
constructs them, and existing 1:1 / 1:N / N:1 relation values match the
non-junction variant unchanged. No codemod required.
-->

# 0.12 → 0.13 — Extension-author upgrade instructions

## `regen-extension-contracts-strip-empty-type-params`

The contract canonicalizer now omits `typeParams` from `storage.types` entries when the
value is an empty object. Previously, emitting a named-type alias like:

```prisma
types {
  Uuid = String @db.Uuid
}
```

produced a `contract.json` entry such as:

```json
"types": {
  "Uuid": {
    "codecId": "pg/text@1",
    "kind": "codec-instance",
    "nativeType": "uuid",
    "typeParams": {}
  }
}
```

From this release the canonicalizer strips `typeParams` when it is empty, so the emitted
form is:

```json
"types": {
  "Uuid": {
    "codecId": "pg/text@1",
    "kind": "codec-instance",
    "nativeType": "uuid"
  }
}
```

Empty and absent `typeParams` are treated as equivalent at every comparison boundary, so
the runtime behaviour is unchanged. The only visible effect is that re-emitting produces a
different `storageHash` — the hash now reflects a `contract.json` without the empty key.

### Re-emit your extension contract

If your extension's `contract.json` carries `"typeParams": {}` on any `storage.types`
entry, re-emit to pick up the canonical form:

```bash
pnpm fixtures:emit
# or, for a single package:
pnpm --filter <your-extension-package> build:contract-space
```

### Re-pin migration baselines

Because the `storageHash` changes, re-generate the migration baselines so
`migrations/refs/head.json`, `end-contract.json`, `end-contract.d.ts`, `migration.json`,
`migration.ts`, and `ops.json` all reflect the new hash:

```bash
node scripts/regen-extension-migrations.mjs
```

The script is idempotent — running it twice produces the same output.

### Validation

After re-emitting and re-pinning, run `pnpm typecheck && pnpm test --filter <your-extension-package>`,
then confirm `prisma-next migration check` passes. The `contract.json` diff should show
`"typeParams": {}` removed from every `storage.types` entry.

## `thread-namespace-id-through-codec-ref-resolver-spi`

Starting at the 0.13 release, every model/table sits in an explicit namespace, and the column-bound codec-resolution SPI in `@prisma-next/sql-relational-core` carries that namespace as a leading, required coordinate. If your extension stamps `codec: CodecRef` onto AST nodes at build time (the "CodecRef invariant for AST authors" path — `descriptors.codecRefForColumn(...)`), or calls the free `codecRefForStorageColumn(...)` against `SqlStorage` directly, you must thread the namespace coordinate through.

### `CodecDescriptorRegistry.codecRefForColumn`

The registry method exported from `@prisma-next/sql-relational-core/query-lane-context` (the `CodecDescriptorRegistry` interface) and built by `buildCodecDescriptorRegistry` (`@prisma-next/sql-relational-core/codec-descriptor-registry`) gained a leading `namespaceId` parameter.

```ts
// Before 0.13
const ref = descriptors.codecRefForColumn('document', 'embedding');

// Starting at 0.13 — namespaceId leads the coordinate args
const ref = descriptors.codecRefForColumn('public', 'document', 'embedding');
```

The namespace is whatever namespace the model/table you are building the ref for lives in — read it from the resolved table coordinate you already hold at the construction site, not a hard-coded literal. The table is now resolved strictly within that namespace, so two same-bare-named tables in different namespaces resolve to their own per-namespace column codecs without colliding.

### `codecRefForStorageColumn`

The free function exported from `@prisma-next/sql-relational-core/codec-descriptor-registry` gained the same leading coordinate, inserted between `storage` and `tableName`.

```ts
// Before 0.13
const ref = codecRefForStorageColumn(storage, 'document', 'embedding');

// Starting at 0.13
const ref = codecRefForStorageColumn(storage, 'public', 'document', 'embedding');
```

It now resolves the table via `resolveStorageTable(storage, tableName, namespaceId)` rather than scanning every namespace for the first bare-name match, so a name that is ambiguous across namespaces is no longer silently bound to whichever namespace happened to enumerate first.

### Validation

This is a type-level signature change — `pnpm typecheck` (or `pnpm build`) pinpoints every call site that still passes the pre-0.13 argument list. Fix each one by inserting the namespace coordinate, then run your extension's standard `pnpm test`.

## Validation by execution

This entry is prose-only — there is no colocated codemod, so no execution-replay applies. The right namespace coordinate is call-site-specific (it depends on which model/table the AST node is bound to), so the translation is per-site agent reasoning rather than a deterministic transform. The substrate diff inside `packages/3-extensions/` in this transition is the same translation downstream extension authors replicate by hand: the namespace coordinate threaded through every column-bound codec-ref construction site. The release-pipeline gate (`pnpm check:upgrade-coverage`) is satisfied by this directory carrying at least one entry; the substantive verification of the consumer-facing translation lives in the published extension-upgrade skill's per-step bump-install-instructions-validate-commit loop, which runs in extension authors' own CI.

## Many-to-many contracts (additive)

No extension-author action required for the many-to-many change: M:N relations became a first-class, validatable contract shape this release (`'N:M'` cardinality with a required `through` junction descriptor). It is additive — existing non-junction relations and the public framework factories (`crossRef`, the contract-builder) are unchanged.
