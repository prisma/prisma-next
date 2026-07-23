---
from: "0.16"
to: "0.17"
changes:
  - id: strip-sha256-hash-prefixes
    summary: |
      Content hashes are bare lowercase hex from 0.17 — the `sha256:` prefix is gone from every
      surface (emitted `contract.json` / `contract.d.ts`, migration manifests, refs, CLI output,
      and the database marker/ledger), and loaders reject the legacy prefixed form. Contract hash
      VALUES are unchanged (only the prefix drops; `pnpm emit` regenerates live artefacts), but
      `migrationHash` VALUES change because the hashed manifest bytes embed the now-bare
      `from`/`to` strings. Run the colocated codemod over your checked-in `migrations/` trees
      FIRST, before the snapshot-layout migrator in the entries below — the 0.17 layout migrator
      accepts only bare-hex trees. The codemod handles both layouts: it strips the prefix from
      every hash literal (manifests, `ops.json`, pre-store sibling contract snapshots, store
      entries under `migrations/snapshots/`, `.d.ts` branded literals), maps the empty-tree
      sentinel `sha256:empty` to `empty`, recomputes each `migrationHash`, and repoints
      `refs/*.json`. Store directory names are the hash's hex, which does not change. Databases
      whose marker/ledger still hold prefixed values report a hash mismatch on verify — there is
      no compatibility shim; re-sign against the regenerated contract (`prisma-next db sign`).
    detection:
      glob: "**/*.{json,ts,tsx}"
      contains:
        - 'sha256:'
      anyMatch: true
    script: ./strip-sha256-hash-prefixes.ts
  - id: migration-contract-snapshots-moved-to-content-addressed-store
    summary: |
      Committed migration contract snapshots move from per-package sibling files
      (`start-contract.json` / `start-contract.d.ts` / `end-contract.json` /
      `end-contract.d.ts`) and per-space head copies
      (`migrations/<space-id>/contract.json` / `contract.d.ts`) into a single
      content-addressed store per migrations root, at
      `migrations/snapshots/<hex>/contract.json` + `contract.d.ts`, where `<hex>`
      is the contract's 64-hex storage hash (bare hex after the
      `strip-sha256-hash-prefixes` entry above, which must run first). Every
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
  - id: scalar-type-descriptors-channel-removed
    summary: |
      The scalar-type descriptor channel is retired in favour of the unified authoring type
      namespace. Projects with custom control-stack setups that import
      `createPostgresScalarTypeDescriptors` / `createSqliteScalarTypeDescriptors`, or that read
      `scalarTypeDescriptors` from a control stack or contract-source context, must migrate:
      those exports are deleted, and scalar types are now zero-arg type-constructor
      contributions in the component's `authoring.type` namespace — e.g.
      `String: { kind: 'typeConstructor', output: { codecId: 'pg/text@1', nativeType: 'text' } }`.
      Read the scalar type names via `stack.scalarTypes`, or the full name ->
      `{ codecId, nativeType }` map via `collectScalarTypeConstructors(stack.authoringContributions.type)`
      from `@prisma-next/framework-components/authoring`. Standard target setups
      (`@prisma-next/postgres`, `@prisma-next/sqlite`) supply the contributions themselves.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "createPostgresScalarTypeDescriptors"
        - "createSqliteScalarTypeDescriptors"
        - "scalarTypeDescriptors"
      anyMatch: true
  - id: postgres-json-rebound-to-native-json
    summary: |
      On the postgres target the PSL `Json` scalar re-binds from `pg/jsonb@1` / `jsonb` to
      `pg/json@1` / `json`; a new bare `Jsonb` scalar carries `pg/jsonb@1` / `jsonb`. Postgres
      schemas that use `Json` and mean jsonb storage (which every pre-0.16 `Json` field did)
      must switch those fields — and `types {}` aliases — to `Jsonb`, then re-run
      `prisma-next contract emit`; with `Jsonb` the emitted `contract.json` is byte-identical
      to the pre-0.16 output. A field left as `Json` now emits a native `json` column and a
      new storage hash, which against an existing jsonb database is a schema change. The
      legacy `@db.Json` attribute path is unchanged (`Json @db.Json` still yields
      `pg/json@1` / `json`), and sqlite/mongo `Json` bindings are untouched. The TS builder
      surface (`field.json()`, `jsonbColumn`) is unchanged and stays jsonb.
    detection:
      glob: "**/*.prisma"
      contains:
        - "Json"
      anyMatch: true
  - id: default-generators-no-longer-set-storage
    summary: |
      `@default(<generator>)` no longer influences a column's storage — the type position is
      the only storage decider. Pre-0.16, a generator default on a bare `String` field re-picked
      the column's storage to a sized char: `String @default(uuid())` / `@default(uuid(7))`
      emitted `sql/char@1` / `character(36)`, `@default(cuid(2))` `character(24)`,
      `@default(nanoid())` `character(21)` (or `character(<size>)` for `nanoid(<size>)`), and
      `@default(ulid())` `character(26)`. From 0.16 such fields emit the target's `String`
      storage (postgres: `pg/text@1` / `text`) with the same execution-time generator, so a
      re-emit produces a new storage hash — against an existing database created with the char
      storage this is a schema change. To keep the prior storage byte-identical, name it in the
      type position: `Char(36) @default(uuid())`, `Char(24) @default(cuid(2))`,
      `Char(21) @default(nanoid())` (or `Char(<size>)` for a sized nanoid), `Char(26)
      @default(ulid())` — or adopt native `Uuid` for `uuid()` if a `uuid`-typed column is
      preferred (that is a schema change too). Then re-run `prisma-next contract emit` and, if
      you accepted a storage change, plan/apply the matching migration. Generator applicability
      validation is unchanged (`uuid()` on `Int` still fails with
      `PSL_INVALID_DEFAULT_APPLICABILITY`), and the TS builder presets
      (`field.id.uuidv4String()`, `field.generated(uuidv4())`, …) are untouched — they bundle
      their `char(N)` storage explicitly.
    detection:
      glob: "**/*.prisma"
      contains:
        - "@default(uuid("
        - "@default(cuid("
        - "@default(nanoid("
        - "@default(ulid("
      anyMatch: true
  - id: postgres-date-rebound-to-pg-date
    summary: |
      On the postgres target, PSL `date` columns — `DateTime @db.Date` and the bare `Date`
      type constructor — re-bind from `pg/timestamptz@1` to the dedicated `pg/date@1` codec.
      The stored native type is unchanged (`date`), so no schema migration is needed, but a
      re-emit changes the column's codec ref and therefore the contract's storage hash: run
      `prisma-next contract emit`, then re-sign any signed database against the regenerated
      contract (`prisma-next db sign`) — verify reports a hash mismatch until you do.
      Contracts emitted before the upgrade keep working (`pg/timestamptz@1` still exists).
      Runtime behavior changes on re-emit: date columns decode as a `Date` at UTC midnight
      (previously the driver's local-midnight `Date` passed through, so the instant depended
      on the process timezone — code reading local getters near midnight in negative-UTC-offset
      zones saw the neighboring day), encode formats `YYYY-MM-DD` from UTC getters, and
      relation `.include()` over a date column now decodes instead of failing with
      `RUNTIME.DECODE_FAILED`. Update tests or application code that pinned the old
      local-midnight instants to expect `new Date(Date.UTC(y, m, d))`.
    detection:
      glob: "**/*.prisma"
      regex:
        - '@db\.Date'
        - '\sDate(\s|\?|\[|$)'
      anyMatch: true

---

# 0.16 → 0.17 — User upgrade instructions

## `strip-sha256-hash-prefixes`

Starting at the 0.17 release, every content hash Prisma Next mints or accepts is bare lowercase hex — the `sha256:` prefix is removed across the board: emitted `contract.json` / `contract.d.ts` (including the `StorageHashBase<'…'>` / `ProfileHashBase<'…'>` branded type literals), migration manifests, refs, CLI output, and the marker/ledger bookkeeping tables in your database. The prefix carried no information (the algorithm never varied per hash), and the hash **value** — not an in-band tag — signals a format change. Loaders and validators now reject the legacy prefixed form outright.

Two distinct effects on your checked-in artefacts:

- **Contract hashes keep their value.** `storageHash` / `profileHash` are computed over contract content, which never embedded its own hash — only the textual prefix drops.
- **Migration hash values change.** `migrationHash` is computed over the manifest bytes, which embed the `from` / `to` contract-hash strings; with those now bare, every recomputed `migrationHash` differs from the stored one.

### Migrate checked-in `migrations/` trees — before the layout migrator

Run the colocated codemod from your project root, **before** `scripts/migrate-migrations-layout.mjs` (the snapshot-layout entries below) — the 0.17 layout migrator accepts only bare-hex trees:

```bash
pnpm exec tsx ./strip-sha256-hash-prefixes.ts
```

For every on-disk migration package (a `migration.json` with a sibling `ops.json`) it strips the prefix from the manifest's `from` / `to`, from hash literals inside `ops.json`, in pre-store sibling contract snapshots (`*-contract.json`, `*.d.ts`, `migration.ts`), and in content-addressed store entries (`migrations/snapshots/<hex>/contract.json` + `contract.d.ts` — the directory name is the hash's hex and does not change), recomputes `migrationHash` over the bare-hex content, and rewrites `refs/*.json` — repointing refs that held old migration hashes at the recomputed ones, and mapping the empty-tree sentinel `sha256:empty` to `empty`. The edit is format-preserving (only hash literals and the recomputed hash value change) and idempotent: re-running over an already-bare tree makes no further changes.

Use `--check` for a dry run that lists files still needing the fix and exits non-zero if any remain:

```bash
pnpm exec tsx ./strip-sha256-hash-prefixes.ts --check
```

### Re-emit live contract artefacts

Regenerate your emitted artefacts so `contract.json` / `contract.d.ts` pick up the bare-hex form:

```bash
pnpm emit
# (runs `prisma-next contract emit` under the hood)
```

The regenerated files differ only in hash representation — the hash values themselves are unchanged.

### Update hash literals your own code carries

If your application or tests hard-code hash strings (asserting a `migrationHash`, comparing a `storageHash`, matching CLI output), drop the `sha256:` prefix — and for migration hashes, read the new value from the regenerated manifest, since the value itself changed.

### Database marker/ledger

There is no compatibility shim: a database whose marker/ledger rows still hold prefixed values reports a hash mismatch on `prisma-next db verify`. Re-sign the database against your regenerated contract:

```bash
prisma-next db sign
```

### Validation

After the codemod and re-emit, run `pnpm typecheck && pnpm test` (or your application's equivalent), and exercise any command that loads your migrations (deploy or migration-status step) — the loader recomputes and verifies each manifest's `migrationHash` on read, so a stale or still-prefixed manifest fails immediately. `git grep -n "sha256:"` over your project should return no hits in committed artefacts.

Also in this release, the ORM client's internal `throw new Error(...)` sites
were converted to a structured-error scheme (`ORM.*` codes via `structuredError`,
or `InternalError` for invariants). These are internal throw sites: the errors
are still `Error` instances with unchanged message text, so application code
that catches them by message or by `instanceof Error` is unaffected. No action
required beyond the migration contract-snapshot layout change above.
