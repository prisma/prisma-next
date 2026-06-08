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

## Many-to-many contracts (additive)

No extension-author action required for the many-to-many change: M:N relations became a first-class, validatable contract shape this release (`'N:M'` cardinality with a required `through` junction descriptor). It is additive — existing non-junction relations and the public framework factories (`crossRef`, the contract-builder) are unchanged.
