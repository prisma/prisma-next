---
from: "0.15"
to: "0.16"
changes:
  - id: extension-supabase-test-utils-export-removed
    summary: |
      `@prisma-next/extension-supabase` no longer exports the `./test/utils` subpath
      (`bootstrapSupabaseShim`). The import typechecked (types shipped in `dist`), but the
      subpath never worked from npm — the shim reads fixture `.sql` files that were never
      published, so every call failed with ENOENT before touching a database. There is no
      working code to migrate: delete the import and whatever test setup called
      `bootstrapSupabaseShim`.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs}"
      contains:
        - "extension-supabase/test/utils"
      anyMatch: true
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
---

<!--
TML-3027 (foreign keys and indexes are discrete contract entities): emitted
contract-shape change. `contract emit` now materializes the per-FK `constraint`/
`index` authoring booleans into discrete entities — a `foreignKeys[]` entry is the
referential constraint only (no `constraint`/`index` fields), and every backing
index (including one backing a FK) is its own named `indexes[]` entry. The booleans
remain as authoring input (`@relation(index:)`, TS `fk({ constraint, index })`,
`foreignKeyDefaults`). Every FK-bearing `contract.json` / `contract.d.ts` in the
repo re-emits to the new shape (the `examples/` diff is that regeneration); a
downstream `contract emit` picks it up automatically with no source change. The
only caller-visible break is TypeScript that reads `.constraint` / `.index` off a
contract's `foreignKeys[]` entry (contract internals, not an app-authoring
surface) — those fields are gone; read the discrete `indexes[]` entry instead. No
migration or DDL change: the schema the planner and `db verify` derive is
identical.
-->

<!--
Supabase integration close-out (TML-2503): docs-only. The `examples/` touch is
`examples/supabase/README.md` — a link into the deleted
`projects/supabase-integration/` workspace removed. No framework surface,
contract shape, or emitted artefact change. Incidental substrate diff only.
-->

<!--
TML-3028 (dependency-graph migration ordering; SchemaDiffIssue.reason removed):
the migration-diff internal `SchemaDiffIssue` lost its `reason` field —
discriminate via the presence of `expected`/`actual`, or the exported
`issueOutcome(issue): ExpectationFailureReason` helper. `ExpectationFailureReason`
keeps its `'not-found' | 'not-expected' | 'not-equal'` values and its export path;
it is now the helper's return type rather than the removed field's type. This is a
framework migration-control internal, not an app-authoring surface. The
`examples/` diff is supabase-example TEST assertions updated from `.reason` to
presence — no runtime, contract, or DDL change. Incidental test-only diff.
-->

<!--
Supabase example env template (TML-2503): docs-only. The `examples/` touch adds
`examples/supabase/.env.example`, naming the two env vars the real-Supabase
acceptance lane already reads (`DATABASE_URL`, `SUPABASE_JWT_SECRET`). Nothing
loads the file — it documents what to export. No framework surface, contract
shape, or emitted artefact change. Incidental substrate diff only.
-->

<!--
Dependabot dev-deps group bump (PR #961): dev-dependency version bumps only
(biome 2.5.2, wrangler, @types/react, @cloudflare/* and friends), plus the
biome.jsonc schema-version alignment and the handful of code sites biome 2.5
newly flags (useOptionalChain / noProto in tests). The `examples/` diff is
package.json devDependency version ranges and biome.jsonc schema versions only —
no framework surface, contract shape, or emitted artefact changes. No user
action required. Incidental substrate diff only.
-->
