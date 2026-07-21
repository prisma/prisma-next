# Deduplicate migration contract snapshots into `migrations/snapshots/`

Linear: [TML-3059](https://linear.app/prisma-company/issue/TML-3059/deduplicate-migration-contract-snapshots-into-migrationssnapshots). Part of the Prisma 8 RC1 program
(prisma/prisma-next PR #986, plan item "Deduplicate migration contract snapshots
into `migrations/snapshots/` (the folder layout freezes at RC)").

All file references are against `origin/main` at the time of writing. Per
`drive/spec/README.md`, the implementer re-verifies every quoted line against
shipped code before acting on it.

## At a glance

Every migration package directory carries full copies of its bracketing
contracts (`start-contract.json` / `start-contract.d.ts` / `end-contract.json` /
`end-contract.d.ts`), and every extension space carries a full head contract
copy (`migrations/<space-id>/contract.json` + `contract.d.ts`). The repository
today commits 78 `end-contract.json` and 60 `start-contract.json` files; a chain
of N migrations stores ~2N contract copies of N+1 distinct contracts.

After this slice, one content-addressed store per migrations root holds every
distinct contract exactly once:

```
migrations/
  snapshots/
    <hex>/                    ← storage-hash hex, `sha256:` prefix stripped
      contract.json           ← canonical contract JSON (canonicalizeJson + '\n')
      contract.d.ts           ← emitted contract types
  app/
    20260513T0507_add_product_category_index/
      migration.ts            ← imports ../../snapshots/<hex>/contract.json (+ types)
      migration.json          ← UNCHANGED (from/to storage hashes already recorded)
      ops.json                ← UNCHANGED
  <space-id>/
    <pkg-dir>/                ← materialised packages: migration.json + ops.json only
    refs/head.json            ← UNCHANGED shape; its hash now resolves through snapshots/
```

Extension **source repos** (e.g. `packages/3-extensions/pgvector/`) have the
shallower layout `migrations/<pkg-dir>/` with packages directly under the
migrations root; their store is `migrations/snapshots/` there too, and their
emitted import path is `../snapshots/<hex>/…` (one level up, not two).

`migration.json` already records `from`/`to` storage hashes, so **no link files
are needed**. Safe because ADR 199 excludes contract snapshots from migration
identity (`migrationHash` covers manifest + ops only) — no committed
`migrationHash` changes. Urgent because the `migrations/` layout freezes as
public surface at RC1.

**Deliberate deviation from the RC1 plan item text:** gzip reader tolerance
(".json.gz accepted from day one") is dropped entirely. TypeScript cannot
resolve a gzipped `.d.ts`, and the emitted `migration.ts` ESM JSON import cannot
decompress, so reader-side tolerance would cover only tooling reads while every
committed `migration.ts` would still break under writer-side compression — the
"non-breaking future option" it was meant to preserve does not exist. The RC1
plan item text is amended as part of delivery (comment + doc edit on PR #986's
branch).

## Settled design decisions (operator discussion, 2026-07-20)

1. **Store layout:** directory per distinct contract at
   `<migrationsRoot>/snapshots/<hex>/` containing `contract.json` and
   `contract.d.ts`. `<hex>` is `storage.storageHash` with the `sha256:` prefix
   stripped (a colon is illegal in Windows filenames). Lowercase 64-char hex.
2. **Both JSON and `.d.ts` dedupe.** `migration.ts` hydrates typed runtime
   clients from both, so the store serves both.
3. **Contract source (PSL/TS) stays out of the store.** No tooling snapshots
   source today (retail-store's per-migration `contract.prisma` files are
   hand-copied, per ADR 197's intermediate-contract workflow), and TS authoring
   mode has no single source file. A source slot later is additive and
   non-breaking. User-owned per-migration copies are untouched.
4. **Keyed by storage hash**, not full-content hash: `migration.json`
   `from`/`to` already carry it (no link files), and it mirrors the Postgres
   control plane's content-addressed `prisma_contract.contract` table
   (`core_hash` text primary key,
   `packages/3-targets/3-targets/postgres/src/contract-free/control-bootstrap.ts:37-62`).
   Note: the parallel is **Postgres-only** — SQLite's control plane inlines
   contract JSON in marker/ledger rows and has no content-addressed table.
   Accepted trade-off: contracts differing only in domain surface (drift
   permitted under ADR 199) conflate under one hash.
5. **Write-if-absent:** if `snapshots/<hex>/` already exists, the write is
   skipped without content comparison (first write wins). Precedent:
   `materialiseExtensionMigrationPackageIfMissing` (`io.ts:117-125`).
6. **One store per migrations root, shared by all spaces.** `snapshots` becomes
   a reserved top-level name under `migrations/` (cannot be a space id).
7. **Per-space head contract copies are deleted:** the seed phase stops writing
   `migrations/<space-id>/contract.json` + `contract.d.ts`; `refs/head.json`
   stays byte-identical in shape and its `hash` resolves through the store.
8. **No gzip anywhere** (see deviation note).
9. **Clean break:** no fallback to the legacy sibling files anywhere; structured
   error on a missing store entry; every committed migration in this repo is
   migrated in this PR. The single known external consumer (Cipherstash) is
   notified directly, as was done for TML-2512.

## Chosen design

### D1. Shared layout helpers (framework-components)

New file `packages/1-framework/1-core/framework-components/src/control/contract-snapshot-layout.ts`
(exported from the existing `control` entrypoint alongside
`control-migration-types.ts`, which targets already import):

```ts
export const CONTRACT_SNAPSHOTS_DIRNAME = 'snapshots';

const STORAGE_HASH_PATTERN = /^sha256:([0-9a-f]{64})$/;

/** Strip the algorithm prefix from a storage hash for use as a directory name. */
export function storageHashHex(storageHash: string): string; // throws Error on non-match

/** Module specifier for the store's contract.json, POSIX separators. */
export function contractSnapshotJsonSpecifier(snapshotsImportPath: string, storageHash: string): string;
// → `${snapshotsImportPath}/${storageHashHex(storageHash)}/contract.json`

/** Type-only module specifier for the store's contract.d.ts (no extension). */
export function contractSnapshotTypesSpecifier(snapshotsImportPath: string, storageHash: string): string;
// → `${snapshotsImportPath}/${storageHashHex(storageHash)}/contract`
```

`storageHashHex` throws a plain `Error` naming the offending value (it guards a
programmer error, not a user input; user-input validation happens in the store
module below). These helpers are the **single** source of the dirname and
specifier shapes — no other code interpolates `'snapshots'` or strips
`'sha256:'`.

### D2. The store module (migration-tools)

New file `packages/1-framework/3-tooling/migration/src/contract-snapshot-store.ts`,
exported via the package's exports map like sibling modules (`io`, `hash`):

```ts
export function contractSnapshotDir(migrationsDir: string, storageHash: string): string;
// join(migrationsDir, CONTRACT_SNAPSHOTS_DIRNAME, storageHashHex(storageHash))

export interface ContractSnapshotInput {
  readonly contractJson: unknown;   // must carry storage.storageHash === storageHash
  readonly contractDts: string;
}

/** Write-if-absent. Returns { written: false } when snapshots/<hex>/ already exists. */
export async function writeContractSnapshot(
  migrationsDir: string,
  storageHash: string,
  input: ContractSnapshotInput,
): Promise<{ readonly written: boolean; readonly dir: string }>;

/** Read + parse contract.json. Throws errorContractSnapshotMissing on ENOENT,
    errorInvalidJson (existing) on parse failure. */
export async function readContractSnapshotJson(migrationsDir: string, storageHash: string): Promise<unknown>;

/** Same read, but missing/unparseable/JSON-null → undefined (parity with the
    tolerant semantics of today's readEndContractJson, io.ts:182-198). */
export async function readContractSnapshotJsonTolerant(migrationsDir: string, storageHash: string): Promise<unknown | undefined>;

/** Read contract.d.ts. Throws errorContractSnapshotMissing on ENOENT. */
export async function readContractSnapshotDts(migrationsDir: string, storageHash: string): Promise<string>;

/** POSIX-relative import path from a migration package dir to the store dir,
    for threading into renderers: relative(packageDir, join(migrationsDir,
    CONTRACT_SNAPSHOTS_DIRNAME)) with '\\' replaced by '/'. */
export function snapshotsImportPathFrom(packageDir: string, migrationsDir: string): string;
```

Write behavior, exactly:

1. Validate `storageHash` via `storageHashHex` (malformed → throw).
2. Assert `(input.contractJson as { storage?: { storageHash?: unknown } }).storage?.storageHash === storageHash`;
   mismatch → `errorContractSnapshotHashMismatch` (below). This is the only
   type-unsafe read and is named and justified at the call site.
3. If `contractSnapshotDir(...)` exists (directory-existence check) → return
   `{ written: false, dir }`.
4. `mkdir(dir, { recursive: true })`; write `contract.json` as
   `` `${canonicalizeJson(input.contractJson)}\n` `` and `contract.d.ts` as
   `input.contractDts`, appending `'\n'` if not already terminated (same
   normalization as today's `writeSnapshotContractArtifacts`,
   `migration-plan.ts:16-27`).

Canonicalization rationale: today two writer paths produce different bytes for
the same contract (`canonicalizeJson`+`\n` in `writeSnapshotContractArtifacts`
vs verbatim `copyFile` in the `copyFilesWithRename` paths). The store always
canonicalizes so the bytes for a given hash are producer-independent — required
for write-if-absent to be sound and for `fixtures:check` stability. When a
producer has only a file path, it reads + `JSON.parse`s and hands the value in.

New errors in `packages/1-framework/3-tooling/migration/src/errors.ts`
(following the house `MigrationToolsError` shape — `code`, `summary`, `why`,
`fix`, `details`):

- `errorContractSnapshotMissing(storageHash, expectedPath)` →
  code `MIGRATION.CONTRACT_SNAPSHOT_MISSING`,
  why: `Expected a contract snapshot for ${storageHash} at "${expectedPath}" but the file does not exist.`,
  fix: `Re-emit the contract snapshot by re-running the command that authored the migration referencing this hash (\`prisma-next migration plan\` for app-space migrations; the extension's contract-space build for extension spaces), or restore migrations/snapshots/ from version control.`,
  details: `{ storageHash, expectedPath }`.
- `errorContractSnapshotHashMismatch(storageHash, actualHash, dir)` →
  code `MIGRATION.CONTRACT_SNAPSHOT_HASH_MISMATCH`, analogous fields.

These are **distinct** from the existing `errorSnapshotMissing` (`errors.ts`),
which belongs to the ADR 218 *ref-paired snapshot* vocabulary (`refs/db.*`) and
is not touched.

### D3. Emitted `migration.ts` import shape

`RenderMigrationMeta` in each of the three renderers gains one required field:

- `packages/3-targets/3-targets/postgres/src/core/migrations/render-typescript.ts`
- `packages/3-targets/3-targets/sqlite/src/core/migrations/render-typescript.ts`
- `packages/3-mongo-target/1-mongo-target/src/core/render-typescript.ts`

```ts
export interface RenderMigrationMeta {
  readonly from: string | null;
  readonly to: string;
  readonly snapshotsImportPath: string; // POSIX-relative, e.g. '../../snapshots'
}
```

`contractImports(meta)` (identical in all three) becomes:

```ts
const reqs: ImportRequirement[] = [
  { moduleSpecifier: contractSnapshotJsonSpecifier(meta.snapshotsImportPath, meta.to),
    symbol: 'endContract', kind: 'default', attributes: { type: 'json' } },
  { moduleSpecifier: contractSnapshotTypesSpecifier(meta.snapshotsImportPath, meta.to),
    symbol: 'Contract', alias: 'End', typeOnly: true },
];
if (meta.from !== null) {
  reqs.push({ moduleSpecifier: contractSnapshotJsonSpecifier(meta.snapshotsImportPath, meta.from),
    symbol: 'startContract', kind: 'default', attributes: { type: 'json' } });
  reqs.push({ moduleSpecifier: contractSnapshotTypesSpecifier(meta.snapshotsImportPath, meta.from),
    symbol: 'Contract', alias: 'Start', typeOnly: true });
}
```

Rendered result for an app-space migration (hex abbreviated for readability —
real specifiers carry the full 64-char hex):

```ts
import endContract from '../../snapshots/93f0…c9e1/contract.json' with { type: "json" };
import type { Contract as End } from '../../snapshots/93f0…c9e1/contract';
import startContract from '../../snapshots/022e…41aa/contract.json' with { type: "json" };
import type { Contract as Start } from '../../snapshots/022e…41aa/contract';
```

The import **symbols** (`endContract`, `startContract`) and the class-body
assignments (`override readonly endContractJson = endContract;` etc.) are
unchanged, as is the baseline behavior (`meta.from === null` → no start
imports, `Migration<never, End>`).

The `snapshotsImportPath` value is computed by the caller via
`snapshotsImportPathFrom(packageDir, migrationsDir)` — `'../../snapshots'` for
app-space and consumer-project extension-space packages
(`migrations/app/<pkg>` / `migrations/<space>/<pkg>`), `'../snapshots'` for
packages in extension source repos (`migrations/<pkg>`). Threading:

- The planner option objects that populate the `#meta` of
  `PlannerProducedPostgresMigration` / `…Sqlite…` / mongo's
  `planner-produced-migration.ts` gain the required `snapshotsImportPath`
  field, passed through to `renderCallsToTypeScript(calls, meta)` untouched.
- `migrations.createPlanner(...).emptyMigration({...})` (used by
  `migration new`, `migration-new.ts:238-246`) gains `snapshotsImportPath` in
  its options object; its `contractJsonPath` option now receives
  `join(contractSnapshotDir(migrationsDir, toStorageHash), 'contract.json')`.
- `migration-plan.ts` / `migration-new.ts` compute the value once per package
  from the already-resolved `migrationsDir` + `packageDir`.

### D4. The postgres data-transform op import (lockstep change)

`DataTransformCall.importRequirements()`
(`packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts:1547-1556`)
currently re-declares the `endContract` default import from
`'./end-contract.json'`. Under D3 that becomes a **second default import of the
same binding from a different specifier** — a compile error in the generated
file (`render-imports.ts` groups by `moduleSpecifier`; duplicate bindings are
not detected).

**Decision: drop the contract entry from `DataTransformCall.importRequirements()`**
(keep its `POSTGRES_MIGRATION_FACADE` entry). The `endContract` binding is
structurally guaranteed: `buildImports` (`render-typescript.ts:78-86`)
unconditionally prepends `contractImports(meta)`, which always emits the end
import, and a `DataTransformCall` only ever renders inside that scaffold
(`renderImports` is called from `buildImports` alone). One comment at the
deletion site records this invariant (the code cannot express it):
`// endContract is imported by the migration scaffold's contractImports; an op never renders outside it.`
This avoids threading render meta through the argument-less
`importRequirements()` interface (declared in
`framework-components/src/control/control-migration-types.ts:165` and
`ts-render/src/ts-expression.ts:37`, with ~26 overrides).

sqlite and mongo op-factory-calls have no contract imports (verified — no
change).

### D5. Producer rewires (authoring commands)

`packages/1-framework/3-tooling/cli/src/commands/migration-plan.ts`:

- Delete `writeSnapshotContractArtifacts` / `writeSnapshotStartContract`
  (lines 16-35 area) and `writeDestinationEndContract` (nested, ~420-435).
- Everywhere a destination contract was written per-package, call
  `writeContractSnapshot(migrationsDir, toHash, { contractJson, contractDts })`
  instead — sources: `toArtifacts` (the `--to <ref>` leg) or the emitted
  project contract (`getEmittedArtifactPaths(contractPathAbsolute)`, reading
  both files and parsing the JSON).
- The predecessor copy block (~618-632: `getEmittedArtifactPaths(join(fromContractSourceDir, 'end-contract.json'))`
  + `copyFilesWithRename` → `start-contract.*`) is **deleted, not repointed**:
  the predecessor's end contract is already in the store under `fromHash`, so
  the start side needs no write at all. The `--from snapshot` /
  `auto-baseline` legs (`snapshotStartContract`) become
  `writeContractSnapshot(migrationsDir, fromHash, snapshotStartContract)`
  (ref-paired snapshots carry both `contractJson` and `contractDts`).
- The auto-baseline legs (~440-590) write their baseline end contract through
  the same store call.
- `fromContract` for the planner is obtained as a **value**:
  `readContractSnapshotJson(migrationsDir, fromHash)` (missing →
  `MIGRATION.CONTRACT_SNAPSHOT_MISSING`, surfaced through the existing
  `mapMigrationToolsError` bridge). `fromContractSourceDir` and the
  `sourceDir`-based copy plumbing are removed where their only purpose was
  locating the predecessor's sibling file; `plan-resolution.ts`'s
  `sourceDir` field is removed if no consumer remains (verify at
  implementation; `contractAt`'s provenance result also carries `sourceDir`).

`migration-new.ts`: same treatment — destination store write replaces the
`copyFilesWithRename` end-contract block (208-235); the predecessor
start-contract copy block including its bespoke ENOENT → `errorFileNotFound`
wrapper (216-238) is deleted (the planner in `migration new` needs the
predecessor value the same way: `readContractSnapshotJson`).

`contract-space-seed-phase.ts` / `emit-contract-space-artifacts.ts`
(`packages/1-framework/3-tooling/migration/src/emit-contract-space-artifacts.ts`):

- Remove the `contract.json` and `contract.d.ts` writes.
- Add `writeContractSnapshot(projectMigrationsDir, inputs.headRef.hash, { contractJson: inputs.contract, contractDts: inputs.contractDts })`.
  Note the store is write-if-absent while the old per-space write was
  "re-emit always wins" — acceptable because a changed extension contract has a
  new hash (a new store entry); an unchanged hash means identical canonical
  content by construction.
- `refs/head.json` emission is unchanged.

### D6. Reader rewires

All store reads key off hashes the reader already holds (`metadata.to`,
`metadata.from`, `headRef.hash`). **Every reader receives the migrations root
explicitly — no reader derives the store location by walking up from a package
directory** (package depth differs between consumer projects and extension
source repos).

1. `io.ts`: delete `END_CONTRACT_FILE` and `readEndContractJson`.
   `readMigrationPackage(dir)` → `readMigrationPackage(dir, { migrationsDir })`
   (required options); `endContractJson` populated via
   `readContractSnapshotJsonTolerant(migrationsDir, metadata.to)` — tolerant
   semantics preserved exactly (missing/unparseable/JSON-`null` → key omitted).
   `readMigrationsDir` gains the same required option and passes it through.
   Every caller threads the real root (enumerated in the plan).
2. `aggregate/aggregate.ts` `readGraphNodeEndContract(packageDir, …)` →
   reads `readContractSnapshotJson(migrationsDir, hash)` +
   `readContractSnapshotDts(migrationsDir, hash)`; `resolveGraphNodeContractAt`
   keeps returning `provenance: 'graph-node'`; its `sourceDir` field is dropped
   unless a live consumer remains (see D5).
3. `aggregate/loader.ts` `loadExtensionSpace`: `readRawContractDeferred` /
   `read-contract-space-contract.ts` → resolve through
   `readContractSnapshotJson(migrationsDir, headRef.hash)`. The
   `contractUnreadable` integrity-problem path (`check-integrity.ts` calling
   `space.contract()`) is preserved — the thrown store error surfaces there.
   When `headRef` itself is missing, behavior is unchanged (existing problem
   flow). `read-contract-space-contract.ts` is deleted.
4. `cli/commands/db-sign.ts` (~116), `db-update.ts` (~132-149), `ref.ts`
   (~117): replace `join(matchingBundle.dirPath, 'end-contract.json')` reads
   with `readContractSnapshotJson(migrationsDir, targetHash)`.
   `db-update.ts`'s `contractJsonPathForSnapshot` becomes
   `join(contractSnapshotDir(migrationsDir, targetHash), 'contract.json')`.
5. `cli/commands/migration-check.ts` `checkSnapshotConsistency` (97-124):
   same tolerance contract, new source — if the store entry for
   `pkg.metadata.to` is absent → `null` (not an issue; runner-independence,
   ADR 199); if present and its `storage.storageHash !== pkg.metadata.to` →
   existing `PN-MIG-CHECK-005` with the message updated to name
   `migrations/snapshots/<hex>/contract.json`. `PN-MIG-CHECK-002`'s
   required-file list for package dirs no longer includes contract files
   (verify what it lists today; only `migration.json`/`ops.json` remain).
6. `cli/src/utils/contract-at-errors.ts` (71-84): message text naming
   `end-contract.json` → name the store path.
7. `cli/src/utils/plan-resolution.ts`: `FromResolution`'s `graph-node` arm
   loses `sourceDir` (see D5/D6.2); the `snapshot` (ref-paired) arm is
   unchanged.

### D7. Reserving `snapshots` as a space name

`packages/1-framework/3-tooling/migration/src/space-layout.ts`: add
`CONTRACT_SNAPSHOTS_DIRNAME` to `RESERVED_SPACE_SUBDIR_NAMES`
(currently `new Set([SPACE_REFS_DIRNAME])`). Grounded consumers that filter on
it: `migration-check.ts:156`, `migration-list.ts:85`, `aggregate/loader.ts:111`.
`gather-disk-contract-space-state.ts:50` calls
`listContractSpaceDirectories` **without** filtering reserved names — add the
filter there (or in `listContractSpaceDirectories` itself if inspection shows
every caller wants it; implementer verifies both call sites and picks the
single place that covers all, documenting which in the PR).

### D8. Init hygiene, cleanup, and fixtures gate

- `cli/src/commands/init/hygiene-gitattributes.ts`: remove `end-contract.json`,
  `end-contract.d.ts`, `start-contract.json`, `start-contract.d.ts` from
  `ARTIFACT_FILENAMES`; add migrations-rooted glob lines
  `migrations/snapshots/**/contract.json linguist-generated` and
  `migrations/snapshots/**/contract.d.ts linguist-generated` (the existing
  bare-filename entries are schema-dir-relative and do not match the store).
  Follow the file's existing mechanism for path-anchored entries; if it only
  supports bare filenames, extend it minimally and pin with the existing
  hygiene tests.
- `cli/src/commands/init/reinit-cleanup.ts` (20-23): drop
  `start-contract.*`/`end-contract.*` from the cleanup list; add the
  `snapshots/` store directory to whatever cleanup scope the command already
  applies to `migrations/` content (match existing semantics — reinit removes
  generated artifacts).
- `package.json` `fixtures:check` diff globs: remove
  `':(glob)**/start-contract.*'` and `':(glob)**/end-contract.*'`; the existing
  `':(glob)**/contract.*'` already matches `snapshots/<hex>/contract.*`.

### D9. Regeneration tooling and one-shot tree migration

- **One-shot migrator** `scripts/migrate-migrations-layout.mjs` (committed;
  referenced by the upgrade note so downstream users can run it):
  for a given migrations root (auto-discover all roots in this repo: every
  directory containing `*/migration.json` or `app/*/migration.json`), per
  migration package dir: read `migration.json`; for `end-contract.json`
  (+`.d.ts`) parse and `writeContractSnapshot(root, metadata.to, …)`; assert
  the file's inner `storage.storageHash === metadata.to` (mismatch → abort
  loudly, nothing deleted); same for `start-contract.*` against
  `metadata.from`; delete the four sibling files; rewrite the committed
  `migration.ts` import block by replacing the exact specifier strings
  `'./end-contract.json'` → store specifier for `metadata.to`,
  `'./end-contract'` → types specifier, and the start pair against
  `metadata.from` (string replacement of the quoted specifiers only — no AST
  work needed; the emitted format is uniform). Per space dir: if
  `contract.json`/`contract.d.ts` exist beside `refs/`, store-write them
  keyed by `refs/head.json`'s `hash` (assert inner hash equality), then
  delete. Re-verify every `migrationHash` after rewrite (must be
  byte-identical — the hash excludes snapshots; abort on any change).
- `scripts/regen-example-migrations.mjs`: per migration dir, keep the
  temp-config `contract emit` step but emit to a temp path, then
  `writeContractSnapshot` the result and **delete the
  rename-to-`end-contract.*` and predecessor-copy steps**; `tsx migration.ts`
  self-emit and biome format steps unchanged. Its `rewriteMigrationHashes`
  new-shape detection (which greps for `endContractJson = endContract`)
  keeps working — verify.
- `scripts/regen-extension-migrations.mjs` and
  `scripts/regen-mongo-end-contract-dts.mjs`: same repoint; the mongo d.ts
  regen writes into the store entry for the migration's `to` hash.

### D10. Documentation and ADR (same PR — no docs-only slicing)

- **New ADR 239** — "Contract snapshots live in a content-addressed store".
  Follows `.agents/rules/adr-writing.mdc` (decision-first with a grounding
  example, no transient references, alternatives last). Records: the store
  layout and naming (decisions 1-6 above), write-if-absent and the ADR 199
  conflation trade-off, the per-space head deletion, gzip's rejection with the
  `.d.ts`/ESM reasoning, and source-slot deferral. **Amends ADR 197**
  (packages no longer carry sibling snapshot copies; the "migration is
  self-contained" property becomes "the migrations tree is self-contained")
  and **ADR 232**'s file-layout claims; ADR 199 and ADR 218 are referenced,
  not changed. Append the index row to `docs/architecture docs/ADR-INDEX.md`
  under `## Migration System` following the existing row format.
- `docs/architecture docs/subsystems/7. Migration System.md`: File Layout
  (288-312), line 100 (sibling-files claim + the "Pinned per-space artifacts
  on disk" anchor), "Contract snapshot" (224-228), and "Runner-side
  independence" (316-322 — the per-space `contract.json` mention). The
  runner-independence property is restated: apply needs `migration.json` +
  `ops.json` per package; `snapshots/` is authoring/planning surface.
- Sweep every other doc hit: `.agents/rules/contract-space-package-layout.mdc`,
  `.agents/rules/never-hand-edit-contract-fixtures.mdc`,
  `docs/glossary.md`, `docs/onboarding/fixtures-emit-and-check.md`,
  `docs/architecture docs/subsystems/6. Ecosystem Extensions & Packs.md`,
  `docs/architecture docs/perf/contract-spaces-overhead.md`,
  `docs/design/10-domains/migration/README.md`,
  `skills/prisma-next-migrations/SKILL.md`,
  `skills/prisma-next-quickstart/SKILL.md`. Historical ADRs (039, 169, 208,
  212, 218, 232) are append-only records — not rewritten; ADR 239 records the
  supersession.
- **Upgrade notes**: new entries under
  `skills/upgrade/prisma-next-upgrade/upgrades/0.15-0.16/` and
  `skills/extension-author/prisma-next-extension-upgrade/upgrades/0.15-0.16/`
  following the existing per-version pattern, documenting the layout change
  and pointing at `scripts/migrate-migrations-layout.mjs`.
- **RC1 plan amendment**: comment on prisma/prisma-next PR #986 recording the
  gzip-scope deviation and (if the branch is still open at merge time) a
  one-line edit to the plan item text.

## Coherence rationale (slice-INVEST "Small")

One outcome — "contract snapshots live only in the store; the sibling-file and
per-space-copy layouts are gone" — with a large but mechanical footprint. The
reviewer reads one concept: a store module, its producers, its readers, and a
mechanical regeneration. Precedent: TML-2512 shipped the same shape (type
removal + producer/consumer sweep + repo-wide regen) as one PR. The committed
tree churn (≈140 deleted snapshot files, ≈78 rewritten `migration.ts` import
blocks, store additions) is script-generated and verifiable by re-running the
script; the hand-written diff is the bounded set in D1-D8.

## Adapter impact

postgres / sqlite / mongo renderers (D3) and the postgres `DataTransformCall`
(D4). No adapter runtime behavior changes; apply-path inputs are unchanged
(`migration.json` + `ops.json` + resolved head contracts).

## Contract impact

None. No contract entities, kinds, or serialization change. `Contract` values
are moved between files, never reshaped. `migrationHash` inputs are untouched
(AC3).

## Pre-investigated edge cases

| # | Edge | Disposition |
|---|---|---|
| E1 | Package depth differs by repo kind (`migrations/app/<pkg>` vs extension repo `migrations/<pkg>`) | Never derive the store path from a package dir; thread `migrationsDir` explicitly (D6); compute import specifiers via `snapshotsImportPathFrom` (D2/D3). |
| E2 | Duplicate `endContract` default import in generated TS if D3 and D4 diverge | D4 deletes the op-level requirement; renderer tests pin single-import output. |
| E3 | Same storage hash, different domain-surface JSON (ADR 199 drift) | Write-if-absent (decision 5); recorded in ADR 239 as accepted conflation. |
| E4 | Data-only migration (`from === to`): start and end resolve to the same store entry; `migration.ts` would emit two imports of the same specifier | `renderImports` merges same-specifier requirements, but the start/end aliases (`End`, `Start`) must both survive — implementer adds a renderer test for `from === to` covering merged value import + both type aliases; if `mergeAttributes`/named-binding merge misbehaves, fix in `render-imports.ts` with the test pinning it. |
| E5 | Windows filenames | No colon in `<hex>`; specifiers built with POSIX separators explicitly (D2). |
| E6 | `snapshots` enumerated as a phantom space | Reserved name (D7), including the unfiltered `gather-disk-contract-space-state.ts` site. |
| E7 | Store entry present but `contract.d.ts` missing (partial write / hand pruning) | `readContractSnapshotDts` throws `MIGRATION.CONTRACT_SNAPSHOT_MISSING` naming the `.d.ts` path; the JSON read does not require the `.d.ts`. |
| E8 | Old-layout project run against new CLI | Clean break: planner predecessor read fails with `MIGRATION.CONTRACT_SNAPSHOT_MISSING`; the upgrade note + migrator script are the remedy. No fallback code path. |
| E9 | External consumer (Cipherstash) | Direct notification before merge, as for TML-2512. |

## Acceptance criteria

1. No file named `start-contract.json`, `start-contract.d.ts`,
   `end-contract.json`, or `end-contract.d.ts` exists anywhere in the
   repository (source, examples, fixtures, apps), and no source code or script
   references those filenames except historical ADRs/upgrade notes.
   Grep gate: `rg -l "start-contract|end-contract" --glob '!docs/architecture docs/adrs/**' --glob '!skills/**/upgrades/**'` → empty.
2. No `migrations/<space-id>/contract.json` or `contract.d.ts` exists;
   `refs/head.json` files are byte-identical to before the change.
3. Every committed `migration.json` is byte-identical to before the change
   (in particular every `migrationHash`). Verified by the migrator script's
   re-hash assertion and by `git diff --stat` inspection in the PR.
4. Every committed `migration.ts` imports contracts only via
   `…/snapshots/<hex>/contract.json` / `…/snapshots/<hex>/contract`, and
   `pnpm typecheck` passes workspace-wide (proves the imports resolve).
5. `prisma-next migration plan` and `migration new` on retail-store produce a
   new migration whose package dir contains only `migration.ts`,
   `migration.json`, `ops.json`, with store entries created write-if-absent;
   re-running is idempotent for existing entries.
6. `prisma-next migration apply` succeeds against a project whose migration
   package dirs contain only `migration.json` + `ops.json` and whose
   `snapshots/` store is intact; and the runner-independence regression from
   TML-2512 still passes with `snapshots/` **deleted entirely** for app space
   (apply reads no snapshots; extension-space head resolution via store is
   exercised separately with the store present).
7. `migration plan` with a missing predecessor store entry fails with
   `MIGRATION.CONTRACT_SNAPSHOT_MISSING` naming the hash and expected path.
8. The seed phase populates the store for extension spaces; the aggregate
   loader resolves extension heads through the store; `migration check`,
   `db sign`, `db update`, and ref advancement work against the store
   (existing e2e journeys green).
9. `pnpm fixtures:check` passes; `pnpm test:packages`, `pnpm test:integration`,
   `pnpm test:e2e`, `pnpm lint:deps` all green.
10. ADR 239 exists and is indexed; subsystem doc 7 and the doc sweep list in
    D10 are updated; both upgrade notes exist; the PR #986 gzip deviation
    comment is posted.

## Out of scope

- **Ref-paired snapshots (`refs/<name>.json` + `refs/<name>.contract.{json,d.ts}`, ADR 218) — out of scope for THIS slice, but now a committed immediate follow-up (not "left as-is").** They are mutable working state paired to a live database, re-emitted on advance, not chain-history duplicates. This slice leaves them untouched to keep its single concept clean. **Decision (operator, 2026-07-21): consolidate them into this store as the very next slice, before the RC layout freeze** — see [plan.md](./plan.md) § "Follow-up slice". The finding that overturns the original "leave them as-is" calculus: the ref entry already stores its hash (`RefEntry = { hash, invariants }`), so `refs/<name>.contract.*` are pure redundant copies of store content; the "couples ref lifecycle to write-if-absent" worry dissolves because every ref-advance path already resolves the contract bytes and can write the store on advance; and collapsing them removes the last full-contract copies in the frozen layout **and** dissolves the "snapshot" concept overload (the ref becomes a pure pointer, leaving one snapshot concept — the content-addressed store).
- Gzip support in any form (decision 8).
- A contract-source slot in the store (decision 3).
- Any change to `migration.json` schema, `migrationHash` inputs, ops format,
  or the DB-side `prisma_contract` tables.
- Pruning/GC tooling for unreferenced store entries (post-RC concern; entries
  are small and content-addressed).
- A general backwards-compatibility policy (tracked under TML-2515, as for
  TML-2512).

## Open questions

None at spec time. (The one judgment call left deliberately to implementation
is D7's filter placement, bounded to two named call sites.)

## References

- ADR 197 — Migration packages snapshot their own contract (amended by ADR 239)
- ADR 199 — Storage-only migration identity (safety argument)
- ADR 218 — ref-paired snapshots (vocabulary boundary; unchanged)
- ADR 232 — a migration is authored against its start and end contract snapshots (amended)
- TML-2512 / `projects/migration-manifest-drop-inline-contracts/` (precedent + prior clean break)
- prisma/prisma-next PR #986 — Prisma 8 RC1 program (parent plan item)
- Postgres control plane content-addressed contract table:
  `packages/3-targets/3-targets/postgres/src/contract-free/control-bootstrap.ts:31-62`
