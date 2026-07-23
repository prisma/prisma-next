---
from: "0.16"
to: "0.17"
changes:
  - id: migration-contract-snapshots-moved-to-content-addressed-store
    summary: |
      Committed migration contract snapshots move from per-package sibling files
      (`start-contract.json` / `start-contract.d.ts` / `end-contract.json` /
      `end-contract.d.ts`) into a single content-addressed store per migrations
      root, at `migrations/snapshots/<hex>/contract.json` + `contract.d.ts`,
      where `<hex>` is the contract's storage hash with the `sha256:` prefix
      stripped. Every distinct contract is stored once, however many migrations
      reference it. An extension source repo keeps the shallow layout — migration
      packages sit directly under `migrations/` (no `app/` segment), so its store
      is `migrations/snapshots/` at the same depth, and every emitted
      `migration.ts` imports its bookend contracts one level up:
      `../snapshots/<hex>/contract.json` / `../snapshots/<hex>/contract.d.ts`
      (a consuming project's `app/`-nested migrations import two levels up,
      `../../snapshots/...` — do not copy that depth into an extension repo).
      This is a clean break: there is no fallback reader for the old sibling-file
      layout, so a committed migrations tree that has not been converted fails to
      load once you upgrade your extension's tooling — `migration plan` /
      `migration new` / `migration check` all read contract snapshots through the
      store only, and a missing store entry fails with
      `MIGRATION.CONTRACT_SNAPSHOT_MISSING` naming the expected hash and path.
      `migration.json` / `ops.json` / `migrationHash` are unaffected — the
      contract snapshot was never part of migration identity, so converting the
      layout changes no migration's hash, and no extension-authoring SPI changes.
      To convert an existing extension repo, run the migrator once from a
      checkout of the `prisma/prisma-next` repository at (or above) the version
      you're upgrading to, pointed at your extension's migrations root:
      `node scripts/migrate-migrations-layout.mjs <path-to-your-migrations-dir>`.
      Per migration package, it reads `migration.json`, write-if-absents the
      destination contract (and the source contract, when present) into the
      store under the matching hash, rewrites the committed `migration.ts`
      import specifiers, and deletes the four sibling files. It asserts every
      contract's inner `storage.storageHash` against the hash it's filed under
      before writing anything (mismatch aborts the whole run, nothing is
      deleted), and re-verifies every `migrationHash` is unchanged after
      conversion. Run it, review the diff, then typecheck your extension package
      to confirm every rewritten `migration.ts` import resolves.
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
      `refs/<name>.contract.d.ts`) are no longer written or read. A ref is now
      only its pointer file, `refs/<name>.json` (`{ hash, invariants }`); the
      contract it names resolves through the same content-addressed store as
      every migration graph node, `migrations/snapshots/<hex>/contract.json` +
      `contract.d.ts`, by that hash. Your extension repo's `migrations/refs/`
      normally carries only the system `head.json` pointer, which was never
      ref-paired — this only matters if your repo also carries named refs
      (e.g. from testing `ref set` against the extension's own migrations
      root). A pointer whose store entry is missing now fails with
      `MIGRATION.CONTRACT_SNAPSHOT_MISSING` naming the expected hash and path,
      rather than silently falling back to the migration graph. The same
      one-shot migrator that folds per-package sibling snapshots (see the
      entry above) also folds any existing `refs/<name>.contract.json` /
      `refs/<name>.contract.d.ts` pairs: it write-if-absents the pair into the
      store under the sibling pointer's `hash`, then deletes the pair — the
      pointer file itself is read but never written, so it stays
      byte-identical. A `.contract.json` with no sibling pointer, or whose
      inner `storage.storageHash` disagrees with the pointer's `hash`, aborts
      the whole run before anything is written or deleted. Run `node
      scripts/migrate-migrations-layout.mjs <path-to-your-migrations-dir>`
      (same invocation as above; one run folds both migration-package and
      ref-paired snapshots), then review the diff.
    detection:
      glob: "**/refs/*.contract.json"
      anyMatch: true
  - id: extension-packs-key-renamed-to-extensions
    summary: |
      The `extensionPacks` key is renamed to `extensions` across the config
      surface, the SPI, and the contract document. In your extension repo:
      (1) any `prisma-next.config.ts` (the extension's own contract space, a
      sibling example app, tests) renames `extensionPacks:` to `extensions:` —
      the old key fails loudly with "Config.extensionPacks is no longer
      supported; rename it to Config.extensions"; (2) the provider-API field
      `ContractSourceContext.composedExtensionPacks` is now
      `composedExtensions`; (3) the emitted `contract.json` / `contract.d.ts`
      top-level key is `extensions`, and because the key sits in the
      canonicalized bytes, every contract's `storageHash` / `executionHash` /
      `profileHash` changes. Re-run your contract-space build
      (`build:contract-space` or `prisma-next contract emit`), re-anchor
      `migrations/refs/head.json` and the `migrations/snapshots/<hex>/` store
      to the new hashes, and re-emit `ops.json` / `migration.json` for the
      head migration (its `to` hash changes). Concept-level SPI type names
      (`ExtensionPackRef`, `ControlExtensionDescriptor`,
      `validateExtensionPackRefs`) are unchanged. Also renamed in the same
      release: `contract.source.sourceFormat` → `format`, and the target
      façades' `defineConfig` option `outputPath` → `output`.
    detection:
      glob: "**/*.{ts,json}"
      contains:
        - "extensionPacks"
        - "composedExtensionPacks"
      anyMatch: true
---

Also in this release, the ORM client's internal `throw new Error(...)` sites
were converted to a structured-error scheme (`ORM.*` codes via `structuredError`,
or `InternalError` for invariants). Those are internal throw sites: the errors
are still `Error` instances with unchanged message text, so extension code that
catches them by message or by `instanceof Error` is unaffected, and the new
`ORM.*` codes are additive — that change alone requires no extension action. The
authoring-plane sweep (TML-3075) is the same shape: internal throw sites in the
contract authoring packages became structured `CONTRACT.*`/`PSL.*` envelopes or
`InternalError`, with message text unchanged, and it standardized two ORM error
`meta` keys (`trait: 'equality'`, `tableName`) that were never part of the
extension surface — also no extension action. The migration contract-snapshot
layout change above is the one that requires converting your extension's
migration tree.
