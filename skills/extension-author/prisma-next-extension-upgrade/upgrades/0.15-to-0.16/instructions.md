---
from: "0.15"
to: "0.16"
changes:
  - id: extension-supabase-test-utils-export-removed
    summary: |
      `@prisma-next/extension-supabase` no longer exports the `./test/utils` subpath
      (`bootstrapSupabaseShim`), and it is no longer a pattern to copy for extension test
      tooling. The import typechecked (types shipped in `dist`), but the subpath never worked
      from npm — the shim reads fixture `.sql` files that were never published, so every call
      failed with ENOENT before touching a database. Delete any import of
      `@prisma-next/extension-supabase/test/utils`; keep hermetic test helpers package-internal
      (tests import them by source path) rather than publishing them as subpath exports whose
      on-disk fixtures don't ship.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs}"
      contains:
        - "extension-supabase/test/utils"
      anyMatch: true
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
---

<!--
TML-3027 (foreign keys and indexes are discrete contract entities): emitted
contract-shape change. `contract emit` now materializes the per-FK `constraint`/
`index` authoring booleans into discrete entities — a `foreignKeys[]` entry is the
referential constraint only (no `constraint`/`index` fields), and every backing
index (including one backing a FK) is its own named `indexes[]` entry. The booleans
remain as authoring input (`@relation(index:)`, TS `fk({ constraint, index })`,
`foreignKeyDefaults`). An extension whose contract declares FKs re-emits to the new
shape on the next `contract emit`, with no authoring change. Extension code that
reads `.constraint` / `.index` off a contract's `foreignKeys[]` entry (e.g. custom
migration/verify logic or a hand-built contract fixture) must drop those fields and
read the discrete `indexes[]` entry instead. No SPI or DDL change: the schema-IR the
planner and `db verify` derive is identical. (The `packages/3-extensions/` diff is
pgvector test fixtures updated to the new FK literal shape.)
-->

<!--
Supabase integration close-out (TML-2503): docs-only. The
`packages/3-extensions/` touch is `packages/3-extensions/supabase/README.md` —
links into the deleted `projects/supabase-integration/` workspace re-pointed at
ADR 237 (the service_role secondary-root decision) or inlined as plain text.
No SPI, contract shape, or emitted artefact change. Incidental substrate diff
only.
-->

<!--
TML-3028 (dependency-graph migration ordering; SchemaDiffIssue.reason removed):
the migration-diff internal `SchemaDiffIssue` lost its `reason` field —
discriminate a diff issue via the presence of `expected`/`actual`, or the
exported `issueOutcome(issue): ExpectationFailureReason` helper from
`@prisma-next/framework-components/control`. `ExpectationFailureReason` keeps its
`'not-found' | 'not-expected' | 'not-equal'` values and its export path; it is now
the helper's return type rather than the removed field's type. This is a framework migration-control
internal, not an extension-authoring SPI. The `packages/3-extensions/` diff is
supabase-extension TEST assertions updated from `.reason` to presence — no runtime,
contract, SPI, or DDL change. Incidental test-only diff.
-->

<!--
TML-2783 (explicit MTI selections): `changes: []`. The `packages/3-extensions/sql-orm-client` diff is limited to internal polymorphic projection planning and regression tests; it changes no public API, contract/emitted artifact, extension-authoring surface, adapter API, or downstream source translation.
-->

<!--
Dependabot dev-deps group bump (PR #961): `changes: []`. The
`packages/3-extensions/` diff is biome.jsonc schema-version alignment for the
biome 2.5.2 dev-dependency bump plus the code sites biome 2.5 newly flags
(useOptionalChain in `sql-orm-client/src/collection.ts`); no SPI, contract
shape, emitted artefact, or extension-authoring surface change. Incidental
substrate diff only.
-->
