# Plan — Deduplicate migration contract snapshots into `migrations/snapshots/`

Spec: [spec.md](./spec.md). Linear: [TML-3059](https://linear.app/prisma-company/issue/TML-3059/deduplicate-migration-contract-snapshots-into-migrationssnapshots).

Design freedom note: every design decision is settled in the spec. Where a task
below says "verify", the implementer confirms a spec-stated code fact against
shipped code before editing (per `drive/spec/README.md`); a mismatch halts the
dispatch and returns to the orchestrator — it is never silently reinterpreted.

## Test cases (derived from acceptance criteria)

| # | Behaviour | Verified by |
|---|---|---|
| TC1 | `storageHashHex` / specifier helpers: valid `sha256:<64hex>` → hex; malformed input throws. | New unit tests in framework-components. |
| TC2 | `writeContractSnapshot`: fresh write creates `snapshots/<hex>/contract.json` (canonicalized + `\n`) + `contract.d.ts` (trailing-newline-normalized); existing dir → `{written:false}`, bytes untouched; hash/JSON mismatch → `MIGRATION.CONTRACT_SNAPSHOT_HASH_MISMATCH`. | New unit tests `contract-snapshot-store.test.ts` (migration-tools). |
| TC3 | `readContractSnapshotJson` missing entry → `MIGRATION.CONTRACT_SNAPSHOT_MISSING` naming hash + path; tolerant variant → `undefined` on missing/unparseable/JSON-`null`; `readContractSnapshotDts` missing `.d.ts` → structured error (E7). | Same test file. |
| TC4 | All three renderers emit store specifiers (end always; start when `from !== null`); baseline emits no start imports; `from === to` renders a compilable merged import with both `End`/`Start` aliases (E4). | Update `render-typescript.test.ts` ×3; new `from === to` case ×3. |
| TC5 | `DataTransformCall.importRequirements()` no longer declares a contract import; rendered migration with a data transform compiles with exactly one `endContract` import (E2). | Update `op-factory-call.rendering.test.ts`, `op-factory-call.lowering.test.ts`; postgres render-typescript roundtrip. |
| TC6 | `migration plan` / `migration new`: package dir gets only `migration.ts` + `migration.json` + `ops.json`; store entries created; second run `{written:false}` idempotent (AC5); predecessor `fromContract` read from store; missing predecessor entry → structured error (AC7/TC-E8). | Update `migration-plan-command.test.ts`, migration-new tests. |
| TC7 | Seed phase writes store entry keyed by `headRef.hash`; writes no per-space `contract.json`/`contract.d.ts`; `refs/head.json` unchanged (AC2/AC8). | Update seed-phase + `emit-contract-space-artefacts` tests, `loader.test.ts`, `contract-space-seed-phase.mongo.test.ts`. |
| TC8 | Aggregate loader resolves extension-space head through the store; unreadable/missing store entry surfaces as the existing `contractUnreadable` integrity problem. | Update `loader.test.ts`, `contract-space-aggregate-loader.ac15.test.ts`. |
| TC9 | `readMigrationPackage(dir, {migrationsDir})` populates `endContractJson` from the store (tolerant); `resolve-recorded-path` still maps it to `destinationContractJson` (ledger upsert unchanged). | Update `io.test.ts`, `resolve-recorded-path.test.ts`, `contract-at.test.ts`. |
| TC10 | `db sign` / `db update` / ref advancement / `migration check` read through the store; CHECK-005 fires on store-vs-manifest drift; absent entry tolerated by `check`. | Update `ref.test.ts`, db-update goldens, migration-check e2e journey. |
| TC11 | Runner independence: apply succeeds with app-space `snapshots/` deleted (TML-2512 regression extended); apply with packages containing only `migration.json` + `ops.json` (AC6). | Extend the existing postgres + sqlite runner-independence integration tests. |
| TC12 | `snapshots` is not enumerated as a space anywhere, including `gather-disk-contract-space-state` (E6). | Unit test on `listContractSpaceDirectories`/consumers with a `snapshots/` dir present. |
| TC13 | Migrator script on a fixture copy: store populated, siblings + per-space copies deleted, `migration.ts` specifiers rewritten, every `migration.json` byte-identical, inner-hash mismatch aborts before deleting (AC1-AC4). | New script test (run against a temp copy of a small fixture chain). |
| TC14 | Whole-repo: AC1 grep gate empty; `pnpm typecheck` green (proves all rewritten imports resolve); `fixtures:check` green with new globs. | CI + explicit grep gates. |

## Reasoning checkpoints

Same protocol as TML-2512: at each checkpoint the implementing agent stops,
requests high reasoning effort from the operator, and waits.

- **Checkpoint A — after T7** (all production code rewired; before any
  committed-tree regeneration). Every producer and reader of the old layout
  has been touched; a missed reader means the regenerated tree breaks a code
  path the tests happen not to cover. Re-read the diff against spec D3-D8's
  inventory before authorizing the tree migration.
- **Checkpoint B — after T9** (tree migrated, before docs/ADR). Inspect
  `git diff --stat` shape: only expected file classes (deletions of sibling
  snapshots + per-space copies, additions under `snapshots/`, `migration.ts`
  import-block rewrites, zero `migration.json` changes). Any `migration.json`
  diff is a hard stop.
- **Checkpoint C — before PR-open**. AC-by-AC pass; confirm the Cipherstash
  notification and the PR #986 deviation comment are queued; confirm upgrade
  notes reference the migrator script.

## Sequencing

Each task is one focused dispatch-sized commit. Tests-before-implementation
where a new surface is created (T1, T2); pinned-output updates travel with the
change that moves them.

### T1 — Layout helpers + store module, tests first

- Add `contract-snapshot-layout.ts` (framework-components) per spec D1 and
  `contract-snapshot-store.ts` (migration-tools) per spec D2, with the two new
  errors in `migration/src/errors.ts` per spec D2.
- New unit tests: TC1, TC2, TC3 (write red first, then implement).
- Export wiring follows each package's existing exports pattern.
- Gates: `pnpm --filter @prisma-next/framework-components test`,
  `pnpm --filter @prisma-next/migration-tools test`, package typechecks.

### T2 — Renderer meta + emitted specifiers (three targets) + data-transform import

- Add `snapshotsImportPath` to `RenderMigrationMeta` and rewrite
  `contractImports` in the three renderers per spec D3; thread the field
  through the planner-produced migration classes' meta.
- Delete `DataTransformCall`'s contract import requirement per spec D4 (with
  the single invariant comment).
- Update the pinned renderer/op tests; add the `from === to` case (TC4, TC5).
- This will not typecheck workspace-wide until T3 threads the new field from
  the CLI — acceptable mid-slice; T2+T3 may land as consecutive commits in one
  dispatch if the executor prefers a green bisect point.
- Gates: target package tests + typechecks.

### T3 — CLI producers (`migration plan`, `migration new`) + seed phase

- Rewire per spec D5: store writes for destination/baseline/ref-snapshot legs,
  predecessor copy blocks deleted, `fromContract` from
  `readContractSnapshotJson`, `emptyMigration` options updated,
  `snapshotsImportPathFrom` threaded, `emit-contract-space-artefacts` writes
  the store + `refs/head.json` only.
- Update `migration-plan-command.test.ts`, migration-new tests, seed-phase
  tests (TC6, TC7).
- Gates: CLI package tests; `pnpm typecheck` workspace-wide returns green here.

### T4 — Reader rewires in migration-tools (io, aggregate, loader)

- Per spec D6.1-D6.3: `readMigrationPackage`/`readMigrationsDir` signature
  change and all callers threaded; `readGraphNodeEndContract` → store;
  loader head resolution → store; `read-contract-space-contract.ts` deleted;
  `sourceDir` removed if no consumer remains (verify per spec D5).
- Update `io.test.ts`, `contract-at.test.ts`, `loader.test.ts`,
  `resolve-recorded-path.test.ts` (TC8, TC9).
- Gates: migration-tools tests; `pnpm lint:deps` (module deleted, exports map
  changed).

### T5 — CLI readers (`db sign`, `db update`, `ref`, `migration check`) + messages

- Per spec D6.4-D6.7. Update goldens and `ref.test.ts` (TC10).
- Gates: CLI tests; affected e2e journey tests
  (`migration-check`, `ref-snapshot-integration`, `migrate-ref-advancement`).

### T6 — Reserved space name + init hygiene + fixtures gate

- Spec D7 (both filter sites verified, one chosen and named in the commit) and
  D8 (`hygiene-gitattributes`, `reinit-cleanup`, `fixtures:check` globs).
- Update init hygiene/reinit tests; TC12.
- Gates: CLI init tests.

### T7 — Runner-independence + integration regressions

- Extend the TML-2512 runner-independence tests per TC11 (postgres + sqlite);
  extension-space store-resolution integration coverage (AC8's journeys).
- **Checkpoint A** after this task.
- Gates: `pnpm test:integration`; targeted e2e journeys.

### T8 — Regen scripts + one-shot migrator

- Rewrite `regen-example-migrations.mjs`, `regen-extension-migrations.mjs`,
  `regen-mongo-end-contract-dts.mjs` per spec D9; write
  `scripts/migrate-migrations-layout.mjs` with its abort-on-mismatch and
  re-hash assertions; script test per TC13.
- Gates: script test; dry run of the migrator on one fixture copy.

### T9 — Migrate the committed tree

- Run the migrator across every migrations root (retail-store, all
  prisma-next-demo fixture chains, mongo-demo, postgis-demo, prisma-next-demo,
  telemetry-backend, multi-extension-monorepo packages, pgvector/postgis/
  paradedb extension repos — the spec's D9 inventory). Run
  `pnpm fixtures:emit` and confirm convergence (no diff on second run).
- Verify: AC1 grep gate; zero `migration.json` diffs; `pnpm typecheck`;
  `pnpm fixtures:check`; full `pnpm test:packages` + `test:integration` +
  `test:e2e`.
- **Checkpoint B** after this task.

### T10 — ADR 239, ADR-INDEX, subsystem doc, doc sweep, upgrade notes

- Per spec D10, including both 0.15-0.16 upgrade notes referencing the
  migrator script. AC10's doc list is the checklist.
- Gates: `rg` sweep for stale layout references outside historical ADRs and
  upgrade notes (AC1's grep gate scoped to docs/skills).

### T11 — Close-out

- Full gate run: `pnpm build`, `pnpm typecheck`, `pnpm lint:deps`,
  `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e`,
  `pnpm fixtures:check`.
- **Checkpoint C.** PR description per `drive-pr-description` (decision-led;
  names the store design, the gzip deviation, the regenerated-tree shape, the
  runner-independence property). Post the PR #986 deviation comment; send the
  Cipherstash notification; Linear issue to Ready-to-be-merged.

## Risk register

- **Risk:** a reader of the old sibling files exists outside the spec's
  inventory (reflection over dir contents rather than the named constants).
  **Mitigation:** deleting `END_CONTRACT_FILE`/`readEndContractJson` and the
  files themselves makes any survivor fail tests or the AC1 grep gate;
  Checkpoint A re-reads the inventory before regeneration.
- **Risk:** `renderImports` misbehaves for the `from === to` merged-import case
  (E4) in a way the current suite never exercised. **Mitigation:** TC4's new
  case lands in T2 before any tree regeneration depends on it.
- **Risk:** the migrator finds a committed snapshot whose inner
  `storage.storageHash` disagrees with its manifest (latent drift).
  **Mitigation:** abort-before-delete semantics (TC13); investigate the drift,
  never paper over it.
- **Risk:** `contractJsonPathForSnapshot` (db-update ref snapshot pairing) has
  semantics beyond "a readable contract.json path" that the store path breaks.
  **Mitigation:** T5 verifies its downstream consumer before the swap; the ref
  e2e journeys gate it.
- **Risk:** extension-repo shallow layout (`../snapshots`) missed somewhere
  because app-space (`../../snapshots`) dominates tests. **Mitigation:**
  extension regen + fixtures:check exercise pgvector/postgis/paradedb repos in
  T9; `snapshotsImportPathFrom` is the only place depth is computed.
- **Risk:** Cipherstash (external) breaks on the new layout. **Mitigation:**
  direct notification (Checkpoint C), upgrade note + migrator script are the
  paved path.

## Follow-up slice — deduplicate ref-paired snapshots into the store

Decision (operator, 2026-07-21): **its own ticket + PR + review**, sequenced
immediately after this slice, both landing **before the RC layout freeze** (a
post-RC change to `refs/*.contract.*` would be breaking). Kept separate because
it touches the ADR-218 subsystem with its own invariants (ref lifecycle,
`db sign` / `db verify`, drift) that merit focused review; it depends on this
slice's store existing. Recorded here so it isn't lost. (Foldable into this PR
if a single atomic frozen-layout change is preferred, but the reviews stay
cleaner apart.)

**Outcome.** `refs/<name>.json` holds only `{ hash, invariants }`; the ref's
contract resolves through `migrations/snapshots/<hex>/`. `refs/<name>.contract.{json,d.ts}`
are deleted — the last full-contract copies in the frozen layout — and the
"snapshot" concept stops being overloaded (ref = pointer; one snapshot store).

**Mechanics (contained — 1 reader + 4 writers).**

- Read side, one reader: `aggregate/aggregate.ts:77` (the `provenance: 'snapshot'`
  branch of `contractAt`) → `readContractSnapshotJson(migrationsDir, refEntry.hash)`.
  Rename/retag the now-misleading `provenance: 'snapshot'` (the read no longer
  comes from a ref-paired file) — resolves the aggregate provenance inversion.
- Write side, four commands, all already routing `readContractIR → writeRefSnapshot`:
  `db-init.ts`, `migrate.ts`, `db-update.ts`, `ref.ts` → `writeContractSnapshot(migrationsDir, hash, { contractJson, contractDts })`
  (write-if-absent) and keep writing the `refs/<name>.json` hash pointer.
- Delete `refs/snapshot.ts` (`writeRefSnapshot` / `readRefSnapshot`) and the
  `MIGRATION.SNAPSHOT_MISSING` path if it dissolves; fold committed
  `refs/*.contract.json` into the store in the migrator; amend ADR 218.

**Invariant (holds by construction).** Every ref-advance path already resolves
the contract bytes (it writes the ref snapshot today), so advancing a ref
writes the store — the ref's hash is always resolvable there. No path sets a
ref hash without the bytes.

**Free wins.** `refs/snapshot.ts` already ships the atomic temp-dir + `rename`
writer the new store lacks — folds in the F05 store-atomicity fix. And ADR 239
(this slice) can then describe the single-store end state instead of a
two-`snapshot`-concept boundary — so its "draw the boundary" burden shrinks to
"refs hold pointers; all contract bytes live in the one store."
