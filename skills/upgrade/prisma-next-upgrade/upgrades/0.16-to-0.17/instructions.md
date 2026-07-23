---
from: "0.16"
to: "0.17"
changes:
  - id: migration-contract-snapshots-moved-to-content-addressed-store
    summary: |
      Committed migration contract snapshots move from per-package sibling files
      (`start-contract.json` / `start-contract.d.ts` / `end-contract.json` /
      `end-contract.d.ts`) and per-space head copies
      (`migrations/<space-id>/contract.json` / `contract.d.ts`) into a single
      content-addressed store per migrations root, at
      `migrations/snapshots/<hex>/contract.json` + `contract.d.ts`, where `<hex>`
      is the contract's storage hash with the `sha256:` prefix stripped. Every
      distinct contract is stored once, however many migrations reference it.
      Every emitted `migration.ts` now imports its bookend contracts from the
      store (`../../snapshots/<hex>/contract.json`, `../../snapshots/<hex>/contract.d.ts`)
      instead of from sibling files in its own directory.
      This is a clean break: there is no fallback reader for the old sibling-file
      layout, so a committed migrations tree that has not been converted fails to
      load once you upgrade — `migration plan` / `migration new` / `migrate` /
      `migration check` all read contract snapshots through the store only, and
      a missing store entry fails with `MIGRATION.CONTRACT_SNAPSHOT_MISSING`
      naming the expected hash and path. `migration.json` / `ops.json` /
      `migrationHash` are unaffected — the contract snapshot was never part of
      migration identity, so converting the layout changes no migration's hash.
      To convert an existing project, run the migrator once per migrations root
      from a checkout of the `prisma/prisma-next` repository at (or above) the
      version you're upgrading to: `node scripts/migrate-migrations-layout.mjs
      [migrationsRoot...]` (with no arguments it auto-discovers every migrations
      root under the current directory). Per migration package, it reads
      `migration.json`, write-if-absents the destination contract (and the
      source contract, when present) into the store under the matching hash,
      rewrites the committed `migration.ts` import specifiers, and deletes the
      four sibling files. Per contract space, it store-writes any remaining
      per-space `contract.json` / `contract.d.ts` keyed by that space's
      `refs/head.json` hash, then deletes it. It asserts every contract's inner
      `storage.storageHash` against the hash it's filed under before writing
      anything (mismatch aborts the whole run, nothing is deleted), and
      re-verifies every `migrationHash` is unchanged after conversion. Run it,
      review the diff, then `pnpm typecheck` (or your project's equivalent) to
      confirm every rewritten `migration.ts` import resolves.
    detection:
      glob: "**/migration.ts"
      contains:
        - "./start-contract.json"
        - "./end-contract.json"
        - "./start-contract'"
        - "./end-contract'"
      anyMatch: true
  - id: ref-paired-snapshots-moved-to-content-addressed-store
    summary: |
      Ref-paired contract snapshot files (`refs/<name>.contract.json` /
      `refs/<name>.contract.d.ts`, written by `ref set` and `--advance-ref`) are
      no longer written or read. A ref is now only its pointer file,
      `refs/<name>.json` (`{ hash, invariants }`); the contract it names
      resolves through the same content-addressed store as every migration
      graph node, `migrations/snapshots/<hex>/contract.json` + `contract.d.ts`,
      by that hash. This is a clean break: a pointer whose store entry is
      missing now fails with `MIGRATION.CONTRACT_SNAPSHOT_MISSING` naming the
      expected hash and path, rather than silently falling back to the
      migration graph. The same one-shot migrator that folds per-package and
      per-space sibling snapshots (see the entry above) also folds any
      existing `refs/<name>.contract.json` / `refs/<name>.contract.d.ts`
      pairs: it write-if-absents the pair into the store under the sibling
      pointer's `hash`, then deletes the pair — the pointer file itself is
      read but never written, so it stays byte-identical. A `.contract.json`
      with no sibling pointer, or whose inner `storage.storageHash` disagrees
      with the pointer's `hash`, aborts the whole run before anything is
      written or deleted. Run `node scripts/migrate-migrations-layout.mjs
      [migrationsRoot...]` (same invocation as above; one run folds both
      migration-package and ref-paired snapshots), review the diff, then
      re-run `prisma-next ref list` to confirm your refs are unaffected.
    detection:
      glob: "**/refs/*.contract.json"
      anyMatch: true
  - id: extension-packs-config-key-renamed-to-extensions
    summary: |
      The `extensionPacks` key is renamed to `extensions` everywhere: the
      low-level `defineConfig` in `prisma-next.config.ts`, the TS builder's
      `defineContract` (record form), runtime/control client options, and the
      top-level key of the emitted `contract.json` / `contract.d.ts`. The old
      config key now fails loudly with "Config.extensionPacks is no longer
      supported; rename it to Config.extensions" — it is never silently
      ignored. Rename the key in `prisma-next.config.ts` (and `contract.ts` /
      `db.ts` if they pass `extensionPacks` to client factories). The target
      façades' `defineConfig` already used `extensions`; only projects on the
      low-level config change. Because the key sits in the canonicalized bytes
      of every contract hash, all three hashes (`storageHash`,
      `executionHash`, `profileHash`) change for every contract: re-emit with
      `prisma-next contract emit`, then re-anchor migrations — regenerate
      `migrations/snapshots/<hex>/` store entries and refs for the new hashes
      (a schema-unchanged project needs a hash-advance migration or a
      re-baseline; the database schema itself does not change).
    detection:
      glob: "**/{prisma-next.config.ts,contract.ts,db.ts}"
      contains:
        - "extensionPacks"
  - id: contract-source-format-key-renamed
    summary: |
      The contract source provider field `sourceFormat` is renamed to `format`
      (`contract.source.format` in the low-level config; provider objects from
      `prismaContract()` / `typescriptContract()` emit the new field
      automatically once upgraded). Rename any literal `sourceFormat:` in
      hand-written provider objects or config assertions.
    detection:
      glob: "**/prisma-next.config.ts"
      contains:
        - "sourceFormat"
  - id: sugar-output-path-key-renamed-to-output
    summary: |
      The target façades' `defineConfig` option `outputPath` is renamed to
      `output`. Semantics are unchanged (a directory; `contract.json` is
      written inside it). Rename the key in `prisma-next.config.ts`.
    detection:
      glob: "**/prisma-next.config.ts"
      contains:
        - "outputPath"
  - id: psl-format-error-class-removed
    summary: |
      The `PslFormatError` class is deleted from `@prisma-next/psl-parser`. `format()`
      on source with parse errors now throws a structured envelope with code
      `PSL.PARSE_FAILED`; the diagnostics previously on `error.diagnostics` are at
      `error.meta.diagnostics`. Replace `error instanceof PslFormatError` with
      `isStructuredError(error) && error.code === 'PSL.PARSE_FAILED'`
      (`isStructuredError` from `@prisma-next/utils/structured-error`). The message
      text is unchanged.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "PslFormatError"
---

Also in this release, the ORM client's internal `throw new Error(...)` sites
were converted to a structured-error scheme (`ORM.*` codes via `structuredError`,
or `InternalError` for invariants). These are internal throw sites: the errors
are still `Error` instances with unchanged message text, so application code
that catches them by message or by `instanceof Error` is unaffected. No action
required beyond the migration contract-snapshot layout change above.
